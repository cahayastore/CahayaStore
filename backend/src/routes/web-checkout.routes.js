'use strict';
/* ════════════════════════════════════════════════════════════════════
   Public Web Checkout (direct-to-payment, guest)
   - POST /api/public/web-checkout            → create order + QRIS invoice
   - GET  /api/payment-gateways/status/:orderNo → poll payment status
   - GET  /api/public/web-checkout/credentials/:orderNo?token=  → delivered product
   Guest flow: email only, access_token returned for later credential access.
   ════════════════════════════════════════════════════════════════════ */
const express = require('express');
const crypto = require('crypto');
const { query, tx } = require('../db');
const { createInvoice, getUniqueMax, verifyPayhookToken } = require('../payment/myqris.service');
const { decryptString } = require('../crypto');
const { issueGatewaySession, issueWebSession, resolveCustomer } = require('../customer-auth');
const { getSetting, KEYS } = require('../settings.service');

const router = express.Router();

const DEFAULT_EXPIRE_MINUTES = Number(process.env.ORDER_EXPIRE_MINUTES) || 30;

// Resolve the configurable order-expiry window (minutes). Cached briefly to
// avoid hitting the DB on every checkout/poll. Admin can change it in Pengaturan.
let _expiryCache = { value: DEFAULT_EXPIRE_MINUTES, at: 0 };
async function getExpireMinutes() {
  const now = Date.now();
  if (now - _expiryCache.at < 30000) return _expiryCache.value;
  let minutes = DEFAULT_EXPIRE_MINUTES;
  try {
    const cfg = await getSetting(KEYS.ORDER_POLICY);
    const m = Number(cfg && cfg.expiry_minutes);
    if (Number.isFinite(m) && m >= 1 && m <= 1440) minutes = Math.round(m);
  } catch { /* fall back to default */ }
  _expiryCache = { value: minutes, at: now };
  return minutes;
}

function genOrderNo() {
  return `CS-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}
function genToken() {
  return crypto.randomBytes(24).toString('hex');
}

/* Extract PayHook auth token (Bearer / X-API-Key / x-payhook-token / ?token). */
function extractWebhookToken(req) {
  const auth = String(req.headers.authorization || '').trim();
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  return String(req.headers['x-api-key'] || req.headers['x-payhook-token'] || req.query.token || '').trim();
}

/* Parse a rupiah amount from a PayHook payload (compact JSON or notification text). */
function parsePayhookAmount(p = {}) {
  const direct = p.amount ?? p.amountDetected ?? p.nominal ?? p.total ?? p.jumlah;
  if (direct != null && Number(direct) > 0) return Math.round(Number(direct));
  const text = String(p.notification_text || p.text || p.bigText || p.notificationText || '');
  const m = text.replace(/[.,](?=\d{3}\b)/g, '').match(/(?:rp\s*)?(\d{3,})/i);
  return m ? Math.round(Number(m[1])) : 0;
}

/* Deliver stock for a paid order. Prefer stock reserved for this order, then any available. */
async function deliverOrder(client, orderId) {
  const oi = await client.query(
    "SELECT id, product_id, quantity FROM order_items WHERE order_id = $1",
    [orderId]
  );
  for (const item of oi.rows) {
    const qty = Math.max(1, Number(item.quantity) || 1);
    for (let n = 0; n < qty; n++) {
      // 1) Prefer stock reserved for this exact order.
      let stock = await client.query(
        `SELECT id FROM product_stocks
          WHERE product_id = $1 AND reserved_order_id = $2 AND status IN ('available','reserved')
          ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [item.product_id, orderId]
      );
      // 2) Fall back to any genuinely available (unreserved or expired reservation) stock.
      if (!stock.rows.length) {
        stock = await client.query(
          `SELECT id FROM product_stocks
            WHERE product_id = $1 AND status = 'available'
              AND (reserved_until IS NULL OR reserved_until < now() OR reserved_order_id = $2)
            ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [item.product_id, orderId]
        );
      }
      if (stock.rows.length) {
        await client.query(
          "UPDATE product_stocks SET status='sold', sold_at=now(), reserved_until=NULL, reserved_order_id=NULL WHERE id = $1",
          [stock.rows[0].id]
        );
        await client.query(
          "UPDATE order_items SET delivered_stock_id = $2 WHERE id = $1",
          [item.id, stock.rows[0].id]
        );
      }
    }
  }
  await client.query("INSERT INTO deliveries (order_id, delivery_type, status) VALUES ($1,'manual','delivered')", [orderId]);
}

/* Deliver purchased credentials to the buyer via Telegram (best-effort). */
async function deliverCredentialsToTelegram(orderId) {
  try {
    // Find buyer telegram id + order info.
    const r = await query(
      `SELECT o.order_no, o.total_amount, u.telegram_id
         FROM orders o LEFT JOIN users u ON u.id = o.user_id
        WHERE o.id = $1`,
      [orderId]
    );
    if (!r.rows.length) return;
    const ord = r.rows[0];
    if (!ord.telegram_id) return; // buyer not linked to Telegram

    // Gather delivered stock items for this order.
    const items = await query(
      `SELECT oi.delivered_stock_id, oi.quantity, p.name AS product_name, p.stock_type,
              s.content_type, s.encrypted_content
         FROM order_items oi
         LEFT JOIN products p ON p.id = oi.product_id
         LEFT JOIN product_stocks s ON s.id = oi.delivered_stock_id
        WHERE oi.order_id = $1`,
      [orderId]
    );

    const { escapeHtml, notifyBuyer } = require('../telegram/bot-loader');
    const lines = [
      '✅ <b>Pembayaran berhasil!</b>',
      `Order: <code>${escapeHtml(ord.order_no)}</code>`,
      '',
    ];
    let hasContent = false;
    for (const it of items.rows) {
      lines.push(`📦 <b>${escapeHtml(it.product_name || 'Produk')}</b>`);
      if (it.delivered_stock_id && it.encrypted_content) {
        let content = '';
        try { content = decryptString(it.encrypted_content); } catch { content = ''; }
        if (content) {
          hasContent = true;
          const isUrl = /^https?:\/\/\S+$/i.test(content.trim());
          if (isUrl) lines.push(`🔗 ${escapeHtml(content.trim())}`);
          else lines.push(`<pre>${escapeHtml(content)}</pre>`);
        }
      } else {
        lines.push('<i>Sedang diproses oleh admin.</i>');
      }
      lines.push('');
    }
    if (!hasContent && !items.rows.some((x) => x.delivered_stock_id)) {
      lines.push('Produk akan segera diproses oleh admin.');
    }
    lines.push('Terima kasih sudah berbelanja di Cahaya Store! 🙏');
    await notifyBuyer(ord.telegram_id, lines.join('\n'));
  } catch (e) {
    console.error('[deliverCredentialsToTelegram]', e.message);
  }
}

/* Expire pending orders past their expiry window and release reserved stock. */
async function expireStaleOrders() {
  return tx(async (client) => {
    const expired = await client.query(
      `UPDATE orders
          SET status = 'expired', payment_status = 'expired', updated_at = now()
        WHERE payment_status IN ('pending','unpaid')
          AND status IN ('pending','pending_payment')
          AND expires_at IS NOT NULL
          AND expires_at < now()
        RETURNING id`
    );
    if (expired.rows.length) {
      const ids = expired.rows.map((r) => r.id);
      await client.query(
        `UPDATE product_stocks
            SET status = 'available', reserved_until = NULL, reserved_order_id = NULL
          WHERE reserved_order_id = ANY($1::uuid[])
            AND status IN ('available','reserved')`,
        [ids]
      );
    }
    // Also free any orphaned reservations whose window simply lapsed.
    await client.query(
      `UPDATE product_stocks
          SET status = 'available', reserved_until = NULL, reserved_order_id = NULL
        WHERE reserved_until IS NOT NULL
          AND reserved_until < now()
          AND status IN ('available','reserved')`
    );
    return expired.rows.length;
  });
}

/* POST /api/public/web-checkout */
router.post('/public/web-checkout', async (req, res) => {
  const { email, customerWhatsapp, items, customerNote } = req.body || {};
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) {
    return res.status(400).json({ success: false, message: 'Email tidak valid.' });
  }
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ success: false, message: 'items wajib diisi.' });
  }

  const productIds = items.map((i) => String(i.productId || i.product_id));
  const pr = await query(
    "SELECT id, name, price, partner_id FROM products WHERE id = ANY($1::uuid[]) AND is_active = TRUE",
    [productIds]
  );
  if (pr.rows.length !== productIds.length) {
    return res.status(400).json({ success: false, message: 'Sebagian produk tidak tersedia.' });
  }
  const pmap = new Map(pr.rows.map((p) => [p.id, p]));

  let total = 0;
  const lines = items.map((i) => {
    const p = pmap.get(String(i.productId || i.product_id));
    const qty = Math.max(1, Number(i.quantity || 1));
    const subtotal = Number(p.price) * qty;
    total += subtotal;
    return { product_id: p.id, partner_id: p.partner_id, name: p.name, quantity: qty, unit_price: Number(p.price), subtotal };
  });

  const orderNo = genOrderNo();
  const accessToken = genToken();

  // Unique amount so PayHook can disambiguate concurrent orders by exact rupiah.
  let uniqueAmount = total;
  try {
    const max = await getUniqueMax();
    const taken = await query(
      `SELECT p.amount FROM payments p
         JOIN orders o ON o.id = p.order_id
        WHERE p.status = 'pending' AND p.amount BETWEEN $1 AND $2`,
      [total, total + max]
    );
    const used = new Set(taken.rows.map((r) => Number(r.amount)));
    for (let add = 0; add <= max; add += 1) {
      if (!used.has(total + add)) { uniqueAmount = total + add; break; }
    }
  } catch { uniqueAmount = total; }

  // ── Resolve the authoritative Telegram identity FIRST (mini app) ──
  // A valid initData represents the user CURRENTLY using the mini app and must
  // win over any stale Bearer/web session left in localStorage from a previous
  // account. This guarantees the order + credential delivery go to the right user.
  let tgChannel = 'web';
  let tgCustomer = null;
  const _telegramInitData = req.body && req.body.telegramInitData;
  if (_telegramInitData) {
    try {
      const { validateInitData } = require('../telegram/miniapp-auth');
      const { ensureTelegramUser } = require('../telegram/handlers/_shared');
      const v = await validateInitData(_telegramInitData);
      if (v.ok && v.user && v.user.id) {
        tgChannel = 'miniapp';
        const tgDbUser = await ensureTelegramUser(v.user);
        if (tgDbUser && tgDbUser.id) {
          const full = await query("SELECT id, email, name, role, password_hash FROM users WHERE id = $1", [tgDbUser.id]);
          if (full.rows.length) tgCustomer = full.rows[0];
        }
      }
    } catch (e) { console.warn('[web-checkout telegram resolve]', e.message); }
  }

  // ── Auto-register customer by email (passwordless). Never sets password. ──
  // Priority: verified Telegram user → existing session → upsert by email.
  const normEmail = String(email).toLowerCase().trim();
  let customer = tgCustomer;
  const existingAuth = customer ? null : resolveCustomer(req);
  try {
    if (!customer && existingAuth) {
      const u = await query("SELECT id, email, name, role, password_hash FROM users WHERE id = $1", [existingAuth.userId]);
      if (u.rows.length) customer = u.rows[0];
    }
    if (!customer) {
      const up = await query(
        `INSERT INTO users (role, name, email, password_hash, is_active)
         VALUES ('buyer', $2, $1, NULL, TRUE)
         ON CONFLICT (email) DO UPDATE SET is_active = TRUE, updated_at = now()
         RETURNING id, email, name, role, password_hash`,
        [normEmail, normEmail.split('@')[0]]
      );
      customer = up.rows[0];
    }
    // Backfill WhatsApp/phone if empty.
    if (customerWhatsapp) {
      await query("UPDATE users SET phone = COALESCE(phone, $2), updated_at = now() WHERE id = $1", [customer.id, customerWhatsapp]);
    }
  } catch (e) {
    console.error('[web-checkout auto-register]', e);
    return res.status(500).json({ success: false, message: 'Gagal memproses akun.' });
  }

  const userHasPassword = Boolean(customer.password_hash);
  // Passwordless account → safe to auto-login. Password account → never auto-login.
  const gatewaySession = userHasPassword ? null : issueGatewaySession(customer);
  const webSessionToken = issueWebSession(customer);

  // ── Channel attribution (already resolved above from initData) ──
  const channel = tgChannel;

  const expireMinutes = await getExpireMinutes();

  try {
    const result = await tx(async (client) => {
      const o = await client.query(
        `INSERT INTO orders (order_no, user_id, buyer_email, customer_whatsapp, total_amount, status, payment_status, access_token, expires_at, channel, customer_note)
         VALUES ($1,$2,$3,$4,$5,'pending_payment','pending',$6, now() + ($7 || ' minutes')::interval, $8, $9) RETURNING *`,
        [orderNo, customer.id, normEmail, customerWhatsapp || null, uniqueAmount, accessToken, String(expireMinutes), channel, (customerNote ? String(customerNote).trim().slice(0, 500) : null)]
      );
      const order = o.rows[0];
      for (const ln of lines) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, partner_id, quantity, unit_price, subtotal)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [order.id, ln.product_id, ln.partner_id, ln.quantity, ln.unit_price, ln.subtotal]
        );
        // Reserve stock items for this order so concurrent buyers can't grab them.
        await client.query(
          `UPDATE product_stocks SET reserved_until = now() + ($3 || ' minutes')::interval, reserved_order_id = $4
             WHERE id IN (
               SELECT id FROM product_stocks
                WHERE product_id = $1 AND status = 'available'
                  AND (reserved_until IS NULL OR reserved_until < now())
                ORDER BY created_at ASC
                LIMIT $2 FOR UPDATE SKIP LOCKED
             )`,
          [ln.product_id, ln.quantity, String(expireMinutes), order.id]
        );
      }
      let invoice;
      try {
        invoice = await createInvoice({ orderNo: order.order_no, amount: uniqueAmount });
      } catch (e) {
        if (e.code === 'MYQRIS_NOT_CONFIGURED') {
          invoice = { provider: 'myqris', payment_ref: null, qr_payload: null, amount: uniqueAmount, raw: null };
        } else throw e;
      }
      await client.query(
        `INSERT INTO payments (order_id, gateway, payment_ref, qr_payload, amount, status, raw_payload)
         VALUES ($1,$2,$3,$4,$5,'pending',$6)`,
        [order.id, invoice.provider, invoice.payment_ref, invoice.qr_payload, uniqueAmount, invoice.raw]
      );
      return { order, invoice };
    });

    res.status(201).json({
      success: true,
      data: {
        orderId: result.order.order_no,
        accessToken,
        amount: uniqueAmount,
        productName: lines[0].name + (lines.length > 1 ? ` +${lines.length - 1} lainnya` : ''),
        quantity: lines.reduce((s, l) => s + l.quantity, 0),
        qrImageUrl: null,
        qrisData: result.invoice.qr_payload || null,
        paymentMethod: 'qris',
        gatewayProvider: result.invoice.provider || 'myqris',
        paymentUrl: null,
        expiresAt: result.order.expires_at,
        webSessionToken,
        gatewaySession,
      },
    });
  } catch (e) {
    console.error('[web-checkout]', e);
    res.status(500).json({ success: false, message: 'Gagal membuat order.' });
  }
});

/* GET /api/payment-gateways/status/:orderNo */
router.get('/payment-gateways/status/:orderNo', async (req, res) => {
  // Opportunistically expire stale pending orders + release reserved stock.
  expireStaleOrders().catch((e) => console.error('[web-checkout expire]', e.message));

  const r = await query(
    "SELECT order_no, payment_status, status, paid_at, expires_at FROM orders WHERE order_no = $1",
    [req.params.orderNo]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Order tidak ditemukan.' });
  const o = r.rows[0];
  res.json({
    success: true,
    data: {
      status: String(o.payment_status || 'pending').toLowerCase(),
      paidAt: o.paid_at,
      expiresAt: o.expires_at,
      transaction: { orderId: o.order_no, orderStatus: o.status },
    },
  });
});

/* GET /api/public/web-checkout/credentials/:orderNo?token= */
router.get('/public/web-checkout/credentials/:orderNo', async (req, res) => {
  const token = String(req.query.token || '');
  const r = await query(
    `SELECT o.id, o.order_no, o.payment_status, o.access_token, o.buyer_email, o.user_id,
            o.paid_at, oi.product_id, oi.delivered_stock_id, p.name AS product_name, p.stock_type
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.order_no = $1
      LIMIT 1`,
    [req.params.orderNo]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Order tidak ditemukan.' });
  const row = r.rows[0];

  // Access guard:
  //  - logged-in owner (Bearer/web-session sub === order.user_id) → allow
  //  - legacy order without user_id → allow if ?token matches access_token
  //  - modern order (has user_id) → owner-only (token alone NOT enough)
  const auth = resolveCustomer(req);
  const isOwner = auth && row.user_id && String(auth.userId) === String(row.user_id);
  const tokenOk = token && token === row.access_token;
  const allowed = isOwner || (!row.user_id && tokenOk);
  if (!allowed) {
    return res.status(404).json({ success: false, message: 'Order tidak ditemukan.' });
  }

  if (row.payment_status !== 'paid') {
    return res.json({
      success: true,
      data: { status: row.payment_status, productName: row.product_name, credentials: null },
    });
  }

  // Resolve delivered content (one-time stock item).
  let credentials = null;
  let stockType = row.stock_type || 'manual';
  if (row.delivered_stock_id) {
    const s = await query("SELECT content_type, encrypted_content FROM product_stocks WHERE id = $1", [row.delivered_stock_id]);
    if (s.rows.length && s.rows[0].encrypted_content) {
      let content = '';
      try { content = decryptString(s.rows[0].encrypted_content); } catch { content = ''; }
      const ct = s.rows[0].content_type;
      const isUrl = /^https?:\/\/\S+$/i.test(content.trim());
      if (isUrl) credentials = { type: 'link', stock_type: 'link', url: content.trim(), content: content.trim() };
      else if (ct === 'code') credentials = { type: 'code', stock_type: 'code', code: content, content };
      else if (ct === 'credential') credentials = { type: 'account', stock_type: 'account', content };
      else credentials = { type: 'note', stock_type: 'note', content };
      stockType = credentials.stock_type;
    }
  }

  res.json({
    success: true,
    data: {
      status: 'paid',
      productName: row.product_name,
      credentials,
      stockType,
      deliveredAt: row.paid_at,
    },
  });
});

/* ── Order history (owner-only) ───────────────────────────────────────
   GET /api/public/web-checkout/orders
   Auth: Bearer accessToken OR ?webSessionToken=. Lists the customer's orders. */
router.get('/public/web-checkout/orders', async (req, res) => {
  const auth = resolveCustomer(req);
  if (!auth) return res.status(401).json({ success: false, message: 'Perlu login.' });
  const r = await query(
    `SELECT o.order_no, o.total_amount, o.payment_status, o.status, o.created_at, o.paid_at, o.access_token,
            COALESCE(json_agg(p.name) FILTER (WHERE p.name IS NOT NULL), '[]') AS products
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.user_id = $1
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 100`,
    [auth.userId]
  );
  res.json({
    success: true,
    data: r.rows.map((o) => ({
      orderId: o.order_no,
      amount: Number(o.total_amount),
      paymentStatus: o.payment_status,
      status: o.status,
      products: o.products,
      token: o.access_token,
      createdAt: o.created_at,
      paidAt: o.paid_at,
    })),
  });
});

/* ── PayHook webhook (Marketku-compatible) ────────────────────────────
   POST /api/payment-gateways/webhook/payhook
   Auth: Bearer <token> | X-API-Key | x-payhook-token | ?token=
   Body (compact JSON): { amount|nominal|total, source, reference, notification_text, ... }
   Matches a pending order by exact amount, marks paid, delivers product. */
async function payhookHandler(req, res) {
  const token = extractWebhookToken(req);
  let verify;
  try { verify = await verifyPayhookToken(token); }
  catch (e) { return res.status(503).json({ status: 'error', message: e.message }); }
  if (!verify.ok) return res.status(401).json({ error: 'Unauthorized' });

  const payload = req.body || {};
  if (payload.test === true || payload.type === 'test' || payload.event === 'test') {
    return res.json({ status: 'ok', message: 'PayHook webhook aktif' });
  }

  const explicitRef = payload.order_ref || payload.order_no || payload.reference || null;
  const amount = parsePayhookAmount(payload);
  if (!explicitRef && !(amount > 0)) {
    return res.json({ status: 'no_match', reason: 'no_amount' });
  }

  try {
    const result = await tx(async (client) => {
      let o;
      if (explicitRef && /^CS-/i.test(String(explicitRef))) {
        o = await client.query("SELECT * FROM orders WHERE order_no = $1 FOR UPDATE", [explicitRef]);
      }
      if (!o || !o.rows.length) {
        // Amount-only match: exactly one pending order with this amount.
        const m = await client.query(
          `SELECT o.* FROM orders o JOIN payments p ON p.order_id = o.id
            WHERE o.payment_status='pending' AND p.status='pending' AND p.amount=$1
            ORDER BY o.created_at DESC`,
          [amount]
        );
        if (m.rows.length > 1) return { reason: 'ambiguous', count: m.rows.length };
        o = m;
      }
      if (!o.rows.length) return { reason: 'no_match' };
      const order = o.rows[0];
      if (order.payment_status === 'paid') return { matched: true, already: true, orderNo: order.order_no };

      await client.query("UPDATE payments SET status='paid', paid_at=now(), raw_payload=$2 WHERE order_id=$1", [order.id, payload]);
      await client.query("UPDATE orders SET payment_status='paid', status='paid', paid_at=now(), updated_at=now() WHERE id=$1", [order.id]);
      const isTopup = order.order_kind === 'topup';
      if (!isTopup) {
        await deliverOrder(client, order.id);
      }
      await client.query("INSERT INTO audit_logs (action, entity_type, entity_id, metadata) VALUES ('payment.paid','order',$1,$2)", [order.id, payload]);
      // Product names for the notification (best-effort).
      const prod = await client.query(
        `SELECT COALESCE(string_agg(p.name, ', '), '') AS names
           FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = $1`,
        [order.id]
      );
      return {
        matched: true,
        orderNo: order.order_no,
        orderId: order.id,
        isTopup,
        userId: order.user_id,
        paid: { orderNo: order.order_no, amount: order.total_amount, email: order.buyer_email, products: prod.rows[0]?.names || '', channel: order.channel },
      };
    });

    if (result.reason === 'ambiguous') return res.json({ status: 'ambiguous', matching_count: result.count });
    if (!result.matched) return res.json({ status: 'no_match', reason: result.reason || 'no_match' });

    // Post-commit side effects (non-blocking; never affect webhook response).
    if (result.matched && !result.already) {
      // Top up → credit wallet; product order → pay referral bonus on first paid order.
      try {
        const wallet = require('../wallet.service');
        if (result.isTopup && result.orderId) {
          wallet.creditTopup(result.orderId).catch((e) => console.error('[payhook topup]', e.message));
        } else if (result.orderId) {
          wallet.payReferralBonus(result.orderId).catch((e) => console.error('[payhook referral]', e.message));
        }
      } catch (e) { console.error('[payhook wallet]', e.message); }
    }

    // Notify admin via Telegram (non-blocking, never affects webhook response).
    if (result.paid) {
      try {
        require('../telegram/bot-loader').notifyOrderPaid(result.paid)
          .catch((e) => console.error('[payhook notify]', e.message));
      } catch (e) { console.error('[payhook notify load]', e.message); }
    }

    // Deliver purchased credentials to the buyer via Telegram (non-blocking).
    if (result.matched && !result.already && !result.isTopup && result.orderId) {
      deliverCredentialsToTelegram(result.orderId)
        .catch((e) => console.error('[payhook deliver tg]', e.message));
    }

    return res.json({ status: 'confirmed', invoice_number: result.orderNo, already: !!result.already });
  } catch (e) {
    console.error('[payhook]', e);
    res.status(500).json({ error: 'Internal error' });
  }
}

router.post('/payment-gateways/webhook/payhook', payhookHandler);
router.post('/payment-gateways/webhook/myqris/payhook', payhookHandler);

module.exports = router;
module.exports.expireStaleOrders = expireStaleOrders;
