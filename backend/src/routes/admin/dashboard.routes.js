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

/* GET /api/admin/analytics?days=14 — sales trend, totals, top products, status. */
router.get('/analytics', async (req, res) => {
  const days = Math.max(7, Math.min(90, Number(req.query.days) || 14));
  const [totals, trend, topProducts, statusBreak, recent] = await Promise.all([
    query(`
      SELECT
        COALESCE(SUM(total_amount) FILTER (WHERE payment_status='paid'),0)::numeric AS revenue_all,
        COALESCE(SUM(total_amount) FILTER (WHERE payment_status='paid' AND paid_at >= now() - interval '7 days'),0)::numeric AS revenue_7d,
        COUNT(*) FILTER (WHERE payment_status='paid')::int AS paid_orders,
        COUNT(*) FILTER (WHERE payment_status='pending')::int AS pending_orders,
        COUNT(*)::int AS total_orders
      FROM orders
    `),
    query(`
      SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
             COALESCE(SUM(o.total_amount) FILTER (WHERE o.payment_status='paid'),0)::numeric AS revenue,
             COUNT(o.id) FILTER (WHERE o.payment_status='paid')::int AS orders
      FROM generate_series((now() - ($1 || ' days')::interval)::date, now()::date, '1 day') AS d(day)
      LEFT JOIN orders o ON date(o.paid_at) = d.day
      GROUP BY d.day ORDER BY d.day
    `, [String(days)]),
    query(`
      SELECT p.name, COUNT(oi.id)::int AS qty, COALESCE(SUM(oi.subtotal),0)::numeric AS revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id AND o.payment_status='paid'
      LEFT JOIN products p ON p.id = oi.product_id
      GROUP BY p.name ORDER BY revenue DESC LIMIT 5
    `),
    query(`SELECT payment_status AS status, COUNT(*)::int AS c FROM orders GROUP BY payment_status`),
    query(`
      SELECT order_no, buyer_email, total_amount, payment_status, created_at
      FROM orders ORDER BY created_at DESC LIMIT 8
    `),
  ]);
  res.json({
    success: true,
    data: {
      days,
      totals: totals.rows[0],
      trend: trend.rows,
      topProducts: topProducts.rows,
      statusBreakdown: statusBreak.rows,
      recentOrders: recent.rows,
    },
  });
});

module.exports = router;
