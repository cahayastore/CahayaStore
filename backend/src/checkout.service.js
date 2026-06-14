'use strict';
/* ════════════════════════════════════════════════════════════════════
   Checkout service — reusable order creation used by BOTH the public
   web-checkout HTTP route AND the in-bot Telegram buy flow.
   Creates an order + reserves stock + issues a QRIS invoice.
   ════════════════════════════════════════════════════════════════════ */
const crypto = require('crypto');
const { query, tx } = require('./db');
const { createInvoice, getUniqueMax } = require('./payment/myqris.service');
const { getSetting, KEYS } = require('./settings.service');

const DEFAULT_EXPIRE_MINUTES = Number(process.env.ORDER_EXPIRE_MINUTES) || 30;

let _expiryCache = { value: DEFAULT_EXPIRE_MINUTES, at: 0 };
async function getExpireMinutes() {
  const now = Date.now();
  if (now - _expiryCache.at < 30000) return _expiryCache.value;
  let minutes = DEFAULT_EXPIRE_MINUTES;
  try {
    const cfg = await getSetting(KEYS.ORDER_POLICY);
    const m = Number(cfg && cfg.expiry_minutes);
    if (Number.isFinite(m) && m >= 1 && m <= 1440) minutes = Math.round(m);
  } catch { /* default */ }
  _expiryCache = { value: minutes, at: now };
  return minutes;
}

function genOrderNo() {
  return `CS-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}
function genToken() {
  return crypto.randomBytes(24).toString('hex');
}

/* Create an order for an already-resolved customer (user row with id).
   items: [{ productId, quantity }]. Returns { order, invoice, accessToken, amount }. */
async function createOrderForCustomer({ customer, items, channel = 'web', customerNote = null, customerWhatsapp = null }) {
  if (!customer || !customer.id) throw new Error('customer required');
  if (!Array.isArray(items) || !items.length) throw new Error('items required');

  const productIds = items.map((i) => String(i.productId || i.product_id));
  const pr = await query(
    "SELECT id, name, price, partner_id FROM products WHERE id = ANY($1::uuid[]) AND is_active = TRUE",
    [productIds]
  );
  if (pr.rows.length !== productIds.length) throw new Error('Sebagian produk tidak tersedia.');
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
      `SELECT p.amount FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE p.status = 'pending' AND p.amount BETWEEN $1 AND $2`,
      [total, total + max]
    );
    const used = new Set(taken.rows.map((r) => Number(r.amount)));
    for (let add = 0; add <= max; add += 1) {
      if (!used.has(total + add)) { uniqueAmount = total + add; break; }
    }
  } catch { uniqueAmount = total; }

  const expireMinutes = await getExpireMinutes();
  const normEmail = customer.email || null;

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

  return {
    order: result.order,
    invoice: result.invoice,
    accessToken,
    amount: uniqueAmount,
    orderNo: result.order.order_no,
    qrisData: result.invoice.qr_payload || null,
    expiresAt: result.order.expires_at,
    lines,
  };
}

module.exports = { createOrderForCustomer, getExpireMinutes, genOrderNo, genToken };
