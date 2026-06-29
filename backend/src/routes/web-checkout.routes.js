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

/* Retry a DB operation a few times on transient concurrency errors
   (serialization failure, deadlock, lock-not-available). Uses small
   exponential backoff with jitter. Non-transient errors rethrow immediately. */
const TRANSIENT_PG = new Set(['40001', '40P01', '55P03']);
async function withRetry(fn, { tries = 5, baseMs = 40, label = 'op' } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      const transient = e && (TRANSIENT_PG.has(e.code) || /deadlock|could not serialize|lock/i.test(e.message || ''));
      if (!transient || attempt === tries) throw e;
      const delay = baseMs * 2 ** (attempt - 1) + Math.floor(Math.random() * baseMs);
      console.warn(`[retry ${label}] attempt ${attempt} failed (${e.code || e.message}); retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/* Pick a unique payment amount atomically inside an open tx `client`.
   A Postgres transaction-level advisory lock keyed by the base total
   serializes ONLY concurrent checkouts of the same price, so two orders can
   never read the same "free" amount and collide. Returns total+offset. */
async function pickUniqueAmount(client, total, max) {
  // Lock scope = base total; released automatically at COMMIT/ROLLBACK.
  await client.query('SELECT pg_advisory_xact_lock($1)', [Number(total)]);
  const taken = await client.query(
    `SELECT p.amount FROM payments p
        JOIN orders o ON o.id = p.order_id
       WHERE p.status = 'pending' AND p.amount BETWEEN $1 AND $2`,
    [total, total + max]
  );
  const used = new Set(taken.rows.map((r) => Number(r.amount)));
  for (let add = 0; add <= max; add += 1) {
    if (!used.has(total + add)) return total + add;
  }
  // All offsets taken (rare): fall back to base; webhook still matches by ref.
  return total;
}
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

async function genOrderNo() {
  // Short, sequential order numbers backed by a Postgres sequence: CS-10001, CS-10002, ...
  const r = await query("SELECT nextval('order_no_seq') AS n");
  return `CS-${r.rows[0].n}`;
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
          "UPDATE product_stocks SET status='sold', sold_at=now(), reserved_until=NULL, reserved_order_id=NULL, sold_order_id=$2 WHERE id = $1",
          [stock.rows[0].id, orderId]
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

    // Gather ALL delivered stock units for this order (qty>1 → multiple rows),
    // joined to their product name. Uses product_stocks.sold_order_id which links
    // every sold unit to the order (fixes "bought 3 but only 1 delivered").
    const items = await query(
      `SELECT s.id AS stock_id, s.content_type, s.encrypted_content, s.barcode_symbology,
              p.name AS product_name, p.stock_type
         FROM product_stocks s
         JOIN products p ON p.id = s.product_id
        WHERE s.sold_order_id = $1
        ORDER BY p.name, s.sold_at ASC`,
      [orderId]
    );

    const { escapeHtml, notifyBuyer, sendPhoto } = require('../telegram/bot-loader');
    const lines = [
      '✅ <b>Pembayaran berhasil!</b>',
      `Order: <code>${escapeHtml(ord.order_no)}</code>`,
      '',
    ];
    // Group all delivered units per product into a SINGLE combined block so the
    // buyer gets one tidy copyable list (one credential per line) instead of N cards.
    // Barcode units are collected separately and sent as scannable images after.
    let hasContent = false;
    const byProduct = new Map();
    const order = [];
    const barcodes = []; // { name, value, symbology }  (symbology 'image' => value is an image URL)
    for (const it of items.rows) {
      const name = it.product_name || 'Produk';
      if (!byProduct.has(name)) { byProduct.set(name, []); order.push(name); }
      if (it.encrypted_content) {
        let content = '';
        try { content = decryptString(it.encrypted_content); } catch { content = ''; }
        if (content) {
          if (it.content_type === 'barcode') {
            const sym = it.barcode_symbology || 'code128';
            barcodes.push({ name, value: content.trim(), symbology: sym });
            // For rendered barcodes show the value as text too; for uploaded
            // images don't dump the raw URL into the text block.
            if (sym !== 'image') byProduct.get(name).push(content.trim());
            else hasContent = true;
          } else {
            byProduct.get(name).push(content.trim());
          }
        }
      }
    }
    for (const name of order) {
      const creds = byProduct.get(name) || [];
      lines.push(`📦 <b>${escapeHtml(name)}</b>`);
      if (creds.length) {
        hasContent = true;
        lines.push(`<pre>${escapeHtml(creds.join('\n'))}</pre>`);
      } else {
        lines.push('<i>Sedang diproses oleh admin.</i>');
      }
      lines.push('');
    }
    if (!hasContent) {
      lines.push('Produk akan segera diproses oleh admin.');
    }
    if (barcodes.length) {
      lines.push('📷 Barcode dikirim sebagai gambar di bawah — tunjukkan/scan saat penukaran.');
    }
    lines.push('Terima kasih sudah berbelanja di Cahaya Store! 🙏');
    await notifyBuyer(ord.telegram_id, lines.join('\n'));

    // Send each barcode as an image (best-effort, never blocks).
    //  - symbology 'image' => admin uploaded a ready-made barcode/voucher image;
    //    send that URL directly.
    //  - otherwise           => render the stored value to a PNG via bwip-js.
    if (barcodes.length) {
      let renderBarcodePng = null;
      try { ({ renderBarcodePng } = require('../barcode.service')); } catch (e) { /* lib missing */ }
      const { InputFile } = require('grammy');
      for (const bc of barcodes) {
        try {
          if (bc.symbology === 'image') {
            const caption = `🏷️ <b>${escapeHtml(bc.name)}</b>`;
            await sendPhoto(ord.telegram_id, bc.value, caption);
          } else if (renderBarcodePng) {
            const png = await renderBarcodePng(bc.value, bc.symbology);
            const caption = `🏷️ <b>${escapeHtml(bc.name)}</b>\n<code>${escapeHtml(bc.value)}</code>`;
            await sendPhoto(ord.telegram_id, new InputFile(png, 'barcode.png'), caption);
          }
        } catch (e) {
          console.error('[deliver barcode]', e.message);
        }
      }
    }
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

  const orderNo = await genOrderNo();
  const accessToken = genToken();

  // Unique amount so PayHook can disambiguate concurrent orders by exact rupiah.
  // The actual pick happens ATOMICALLY inside the order transaction below (under
  // a per-total advisory lock) so simultaneous same-price checkouts can't collide.
  const uniqueMax = await getUniqueMax().catch(() => 50);

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
    const result = await withRetry((attempt) => tx(async (client) => {
      // Atomically choose a collision-free amount under a per-total advisory lock.
      const uniqueAmount = await pickUniqueAmount(client, total, uniqueMax);
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
      return { order, invoice, uniqueAmount };
    }), { label: 'web-checkout' });

    const uniqueAmount = result.uniqueAmount;
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

/* GET /api/public/web-checkout/qr/:orderNo — branded QRIS card image for
   the web payment page (same style as the bot). Returns a PNG. Public: the QR
   payload is already shown to the buyer; no credentials are exposed here. */
router.get('/public/web-checkout/qr/:orderNo', async (req, res) => {
  try {
    const r = await query(
      `SELECT o.id, o.order_no, o.total_amount, o.payment_status,
              pay.qr_payload,
              (SELECT p.name FROM order_items oi JOIN products p ON p.id = oi.product_id
                WHERE oi.order_id = o.id ORDER BY oi.id ASC LIMIT 1) AS product_name,
              (SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id = o.id) AS qty
         FROM orders o
         LEFT JOIN payments pay ON pay.order_id = o.id
        WHERE o.order_no = $1
        ORDER BY pay.created_at DESC NULLS LAST
        LIMIT 1`,
      [req.params.orderNo]
    );
    if (!r.rows.length || !r.rows[0].qr_payload) {
      return res.status(404).json({ success: false, message: 'QR tidak ditemukan.' });
    }
    const row = r.rows[0];
    const { buildQrisCard } = require('../qris-card.service');
    const qty = Number(row.qty) || 1;
    const subtitle = row.product_name ? `${row.product_name}${qty > 1 ? ' × ' + qty : ''}` : '';
    const png = await buildQrisCard({
      qrisData: row.qr_payload,
      orderNo: row.order_no,
      amount: Number(row.total_amount) || 0,
      subtitle,
    });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=300');
    return res.end(png);
  } catch (e) {
    console.error('[web-checkout qr png]', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

/* GET /api/public/web-checkout/barcode/:orderNo.png?token=
   Renders the buyer's purchased barcode as a PNG. Re-verifies owner/token and
   reads the barcode VALUE server-side (never from the URL). */
router.get('/public/web-checkout/barcode/:orderNo.png', async (req, res) => {
  try {
    const token = String(req.query.token || '');
    const orderNo = req.params.orderNo;
    const r = await query(
      `SELECT o.id, o.payment_status, o.access_token, o.user_id
         FROM orders o WHERE o.order_no = $1 LIMIT 1`,
      [orderNo]
    );
    if (!r.rows.length) return res.status(404).end();
    const row = r.rows[0];

    const auth = resolveCustomer(req);
    const isOwner = auth && row.user_id && String(auth.userId) === String(row.user_id);
    const tokenOk = token && token === row.access_token;
    if (!(isOwner || (!row.user_id && tokenOk))) return res.status(404).end();
    if (row.payment_status !== 'paid') return res.status(404).end();

    const sold = await query(
      "SELECT encrypted_content, barcode_symbology FROM product_stocks WHERE sold_order_id = $1 AND content_type = 'barcode' ORDER BY sold_at ASC LIMIT 1",
      [row.id]
    );
    if (!sold.rows.length || !sold.rows[0].encrypted_content) return res.status(404).end();
    let value = '';
    try { value = decryptString(sold.rows[0].encrypted_content); } catch { value = ''; }
    if (!value) return res.status(404).end();

    const { renderBarcodePng } = require('../barcode.service');
    const png = await renderBarcodePng(value.trim(), sold.rows[0].barcode_symbology || 'code128');
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'private, max-age=60');
    res.send(png);
  } catch (e) {
    console.error('[web-checkout barcode png]', e.message);
    res.status(500).end();
  }
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

  // Resolve ALL delivered content units for this order (qty>1 supported) via
  // product_stocks.sold_order_id. Returns a single 'credentials' (first unit, for
  // backward compatibility) plus a full 'items' array.
  let credentials = null;
  let stockType = row.stock_type || 'manual';
  const items = [];
  const sold = await query(
    "SELECT content_type, encrypted_content, barcode_symbology FROM product_stocks WHERE sold_order_id = $1 ORDER BY sold_at ASC",
    [row.id]
  );
  for (const st of sold.rows) {
    if (!st.encrypted_content) continue;
    let content = '';
    try { content = decryptString(st.encrypted_content); } catch { content = ''; }
    if (!content) continue;
    const ct = st.content_type;
    const isUrl = /^https?:\/\/\S+$/i.test(content.trim());
    let cred;
    if (ct === 'barcode') {
      const sym = st.barcode_symbology || 'code128';
      if (sym === 'image') {
        // Admin uploaded a ready-made barcode/voucher image; serve that URL as-is.
        cred = {
          type: 'barcode', stock_type: 'barcode', symbology: 'image',
          imageUrl: content.trim(),
        };
      } else {
        cred = {
          type: 'barcode', stock_type: 'barcode', symbology: sym,
          content: content.trim(),
          // Buyer-facing PNG render. The route re-verifies owner/token and renders
          // the actual sold barcode server-side (value is NOT taken from the URL).
          imageUrl: `/api/public/web-checkout/barcode/${encodeURIComponent(row.order_no)}.png`
            + `?token=${encodeURIComponent(token || '')}`,
        };
      }
    } else if (isUrl) cred = { type: 'link', stock_type: 'link', url: content.trim(), content: content.trim() };
    else if (ct === 'code') cred = { type: 'code', stock_type: 'code', code: content, content };
    else if (ct === 'credential') cred = { type: 'account', stock_type: 'account', content };
    else cred = { type: 'note', stock_type: 'note', content };
    items.push(cred);
    if (!credentials) { credentials = cred; stockType = cred.stock_type; }
  }

  res.json({
    success: true,
    data: {
      status: 'paid',
      productName: row.product_name,
      credentials,
      items,
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
    const result = await withRetry((attempt) => tx(async (client) => {
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
    }), { label: 'payhook' });

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
module.exports.deliverCredentialsToTelegram = deliverCredentialsToTelegram;
module.exports.deliverOrder = deliverOrder;
