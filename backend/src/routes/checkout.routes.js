'use strict';
const express = require('express');
const { query, tx } = require('../db');
const { createInvoice } = require('../payment/myqris.service');

const router = express.Router();

// Basic UUID v1-v5 shape check so a missing/garbage product_id returns a clean
// 400 instead of throwing "invalid input syntax for type uuid" deeper in PG.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.post('/checkout', async (req, res) => {
  const { items, buyer } = req.body || {};
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ success: false, message: 'items required' });
  }
  const productIds = items.map(i => String(i.product_id ?? ''));
  if (!productIds.every(id => UUID_RE.test(id))) {
    return res.status(400).json({ success: false, message: 'Setiap item butuh product_id yang valid.' });
  }
  const r = await query(
    "SELECT id, name, price, partner_id FROM products WHERE id = ANY($1::uuid[]) AND is_active = TRUE",
    [productIds]
  );
  if (r.rows.length !== productIds.length) {
    return res.status(400).json({ success: false, message: 'Some products unavailable' });
  }
  const priceMap = new Map(r.rows.map(p => [p.id, p]));
  let total = 0;
  const lines = items.map(i => {
    const p = priceMap.get(String(i.product_id));
    const qty = Math.max(1, Number(i.quantity || 1));
    const subtotal = Number(p.price) * qty;
    total += subtotal;
    return { product_id: p.id, partner_id: p.partner_id, quantity: qty, unit_price: Number(p.price), subtotal };
  });

  const orderNo = `CS-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  try {
    const result = await tx(async (client) => {
      const o = await client.query(
        `INSERT INTO orders (order_no, buyer_name, buyer_email, buyer_phone, total_amount, status, payment_status)
         VALUES ($1,$2,$3,$4,$5,'pending_payment','pending') RETURNING *`,
        [orderNo, buyer?.name || null, buyer?.email || null, buyer?.phone || null, total]
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
        invoice = await createInvoice({ orderNo: order.order_no, amount: total });
      } catch (e) {
        if (e.code === 'MYQRIS_NOT_CONFIGURED') {
          invoice = { provider: 'myqris', payment_ref: null, qr_payload: null, amount: total, raw: null, configured: false };
        } else throw e;
      }
      const p = await client.query(
        `INSERT INTO payments (order_id, gateway, payment_ref, qr_payload, amount, status, raw_payload)
         VALUES ($1,$2,$3,$4,$5,'pending',$6) RETURNING *`,
        [order.id, invoice.provider, invoice.payment_ref, invoice.qr_payload, total, invoice.raw]
      );
      return { order, payment: p.rows[0], invoice };
    });
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    console.error('[checkout]', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

router.get('/orders/:orderNo', async (req, res) => {
  const r = await query(
    `SELECT o.*, json_agg(oi.*) AS items
     FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
     WHERE o.order_no = $1 GROUP BY o.id`,
    [req.params.orderNo]
  );
  if (!r.rows.length) return res.status(404).json({ success: false });
  res.json({ success: true, data: r.rows[0] });
});

module.exports = router;
