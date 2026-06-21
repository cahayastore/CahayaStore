'use strict';
const express = require('express');
const { query, tx } = require('../../db');
const { decryptString } = require('../../crypto');

const router = express.Router();

router.get('/orders', async (_req, res) => {
  const r = await query(`
    SELECT id, order_no, buyer_name, buyer_email, customer_note, total_amount,
           status, payment_status, created_at, paid_at, channel, order_kind
    FROM orders
    ORDER BY created_at DESC
    LIMIT 200
  `);
  res.json({ success: true, data: r.rows });
});

router.get('/orders/:id', async (req, res) => {
  const r = await query(`
    SELECT o.*, COALESCE(json_agg(oi.*) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.id = $1
    GROUP BY o.id
  `, [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ success: false });
  res.json({ success: true, data: r.rows[0] });
});

/* GET /api/admin/orders/:id/credentials — delivered account/credential units
   for this order (decrypted), so admin can see exactly what was sent. */
router.get('/orders/:id/credentials', async (req, res) => {
  try {
    const o = await query(
      "SELECT id, order_no, buyer_email FROM orders WHERE id = $1",
      [req.params.id]
    );
    if (!o.rows.length) return res.status(404).json({ success: false, message: 'Order tidak ditemukan.' });
    const sold = await query(
      `SELECT s.id, s.content_type, s.encrypted_content, s.sold_at, p.name AS product_name
         FROM product_stocks s
         JOIN products p ON p.id = s.product_id
        WHERE s.sold_order_id = $1
        ORDER BY p.name, s.sold_at ASC`,
      [req.params.id]
    );
    const items = sold.rows.map((r) => {
      let content = '';
      try { content = r.encrypted_content ? decryptString(r.encrypted_content) : ''; } catch { content = ''; }
      return { product_name: r.product_name, content_type: r.content_type, content, sold_at: r.sold_at };
    });
    res.json({ success: true, data: { orderNo: o.rows[0].order_no, items } });
  } catch (e) {
    console.error('[order credentials]', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

/* POST /api/admin/orders/:id/verify-deliver — manually mark an order as paid
   (for payments that failed auto-verification), deliver any missing stock, and
   (re)send the credentials to the buyer via Telegram. Safe to click again to
   re-deliver the message. */
router.post('/orders/:id/verify-deliver', async (req, res) => {
  const orderId = req.params.id;
  try {
    const or = await query("SELECT * FROM orders WHERE id = $1", [orderId]);
    if (!or.rows.length) return res.status(404).json({ success: false, message: 'Order tidak ditemukan.' });
    const order = or.rows[0];
    const alreadyPaid = String(order.payment_status).toLowerCase() === 'paid';

    if (order.order_kind === 'topup') {
      await tx(async (client) => {
        await client.query(
          "UPDATE orders SET payment_status='paid', status='paid', paid_at=COALESCE(paid_at, now()), updated_at=now() WHERE id=$1",
          [orderId]
        );
        await client.query("UPDATE payments SET status='paid', paid_at=COALESCE(paid_at, now()) WHERE order_id=$1", [orderId]).catch(() => {});
      });
      try { await require('../../wallet.service').creditTopup(orderId); } catch (e) { console.error('[verify topup credit]', e.message); }
      return res.json({ success: true, data: { kind: 'topup', wasPaid: alreadyPaid, message: 'Top up diverifikasi & saldo dikreditkan.' } });
    }

    const web = require('../../routes/web-checkout.routes');
    await tx(async (client) => {
      await client.query(
        "UPDATE orders SET payment_status='paid', status='paid', paid_at=COALESCE(paid_at, now()), updated_at=now() WHERE id=$1",
        [orderId]
      );
      await client.query("UPDATE payments SET status='paid', paid_at=COALESCE(paid_at, now()) WHERE order_id=$1", [orderId]).catch(() => {});
      const delivered = await client.query("SELECT count(*)::int AS n FROM product_stocks WHERE sold_order_id = $1", [orderId]);
      const needed = await client.query("SELECT COALESCE(SUM(quantity),0)::int AS n FROM order_items WHERE order_id = $1", [orderId]);
      if (Number(delivered.rows[0].n) < Number(needed.rows[0].n) && typeof web.deliverOrder === 'function') {
        await web.deliverOrder(client, orderId);
      }
    });

    let delivered = false;
    try {
      if (typeof web.deliverCredentialsToTelegram === 'function') {
        await web.deliverCredentialsToTelegram(orderId);
        delivered = true;
      }
    } catch (e) { console.error('[verify deliver tg]', e.message); }

    res.json({
      success: true,
      data: {
        kind: 'product',
        wasPaid: alreadyPaid,
        delivered,
        message: alreadyPaid ? 'Akun dikirim ulang ke pembeli.' : 'Pembayaran diverifikasi & akun dikirim.',
      },
    });
  } catch (e) {
    console.error('[order verify-deliver]', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
