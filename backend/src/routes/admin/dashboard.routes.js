'use strict';
const express = require('express');
const { query } = require('../../db');

const router = express.Router();

router.get('/dashboard', async (_req, res) => {
  const [products, orders, paidToday, settings] = await Promise.all([
    query("SELECT COUNT(*)::int AS c FROM products WHERE is_active = TRUE"),
    query("SELECT COUNT(*)::int AS c FROM orders"),
    query("SELECT COALESCE(SUM(total_amount),0)::numeric AS s FROM orders WHERE payment_status='paid' AND paid_at >= now() - interval '24 hours'"),
    query("SELECT COUNT(*)::int AS c FROM settings")
  ]);
  res.json({
    success: true,
    data: {
      products: products.rows[0].c,
      orders: orders.rows[0].c,
      paid_24h: Number(paidToday.rows[0].s),
      settings: settings.rows[0].c
    }
  });
});

module.exports = router;
