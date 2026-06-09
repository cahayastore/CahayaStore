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

const router = express.Router();

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

/* Deliver stock for a paid order (assign one available item per order item). */
async function deliverOrder(client, orderId) {
  const oi = await client.query("SELECT id, product_id FROM order_items WHERE order_id = $1", [orderId]);
  for (const item of oi.rows) {
    const stock = await client.query(
      `SELECT id FROM product_stocks WHERE product_id = $1 AND status = 'available'
        ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [item.product_id]
    );
    if (stock.rows.length) {
      await client.query("UPDATE product_stocks SET status='sold', sold_at=now() WHERE id = $1", [stock.rows[0].id]);
      await client.query("UPDATE order_items SET delivered_stock_id = $2 WHERE id = $1", [item.id, stock.rows[0].id]);
    }
  }
  await client.query("INSERT INTO deliveries (order_id, delivery_type, status) VALUES ($1,'manual','delivered')", [orderId]);
}

/* POST /api/public/web-checkout */
router.post('/public/web-checkout', async (req, res) => {
  const { email, customerWhatsapp, items } = req.body || {};
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

  try {
    const result = await tx(async (client) => {
      const o = await client.query(
        `INSERT INTO orders (order_no, buyer_email, customer_whatsapp, total_amount, status, payment_status, access_token)
         VALUES ($1,$2,$3,$4,'pending_payment','pending',$5) RETURNING *`,
        [orderNo, String(email).toLowerCase().trim(), customerWhatsapp || null, uniqueAmount, accessToken]
      );
      const order = o.rows[0];
      for (const ln of lines) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, partner_id, quantity, unit_price, subtotal)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [order.id, ln.product_id, ln.partner_id, ln.quantity, ln.unit_price, ln.subtotal]
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
        expiresAt: null,
      },
    });
  } catch (e) {
    console.error('[web-checkout]', e);
    res.status(500).json({ success: false, message: 'Gagal membuat order.' });
  }
});

/* GET /api/payment-gateways/status/:orderNo */
router.get('/payment-gateways/status/:orderNo', async (req, res) => {
  const r = await query(
    "SELECT order_no, payment_status, status, paid_at FROM orders WHERE order_no = $1",
    [req.params.orderNo]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Order tidak ditemukan.' });
  const o = r.rows[0];
  res.json({
    success: true,
    data: {
      status: String(o.payment_status || 'pending').toLowerCase(),
      paidAt: o.paid_at,
      transaction: { orderId: o.order_no, orderStatus: o.status },
    },
  });
});

/* GET /api/public/web-checkout/credentials/:orderNo?token= */
router.get('/public/web-checkout/credentials/:orderNo', async (req, res) => {
  const token = String(req.query.token || '');
  const r = await query(
    `SELECT o.id, o.order_no, o.payment_status, o.access_token, o.buyer_email,
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
  if (!token || token !== row.access_token) {
    return res.status(403).json({ success: false, message: 'Token akses tidak valid.' });
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
      await deliverOrder(client, order.id);
      await client.query("INSERT INTO audit_logs (action, entity_type, entity_id, metadata) VALUES ('payment.paid','order',$1,$2)", [order.id, payload]);
      return { matched: true, orderNo: order.order_no };
    });

    if (result.reason === 'ambiguous') return res.json({ status: 'ambiguous', matching_count: result.count });
    if (!result.matched) return res.json({ status: 'no_match', reason: result.reason || 'no_match' });
    return res.json({ status: 'confirmed', invoice_number: result.orderNo, already: !!result.already });
  } catch (e) {
    console.error('[payhook]', e);
    res.status(500).json({ error: 'Internal error' });
  }
}

router.post('/payment-gateways/webhook/payhook', payhookHandler);
router.post('/payment-gateways/webhook/myqris/payhook', payhookHandler);

module.exports = router;
