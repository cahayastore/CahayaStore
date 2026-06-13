'use strict';
const express = require('express');
const { query } = require('../../db');

const router = express.Router();

router.get('/orders', async (_req, res) => {
  const r = await query(`
    SELECT id, order_no, buyer_name, buyer_email, customer_note, total_amount,
           status, payment_status, created_at, paid_at
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

module.exports = router;
