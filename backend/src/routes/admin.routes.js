'use strict';
const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../auth.middleware');
const { getSetting, setSetting, listSettings, KEYS } = require('../settings.service');

const router = express.Router();
router.use(requireAuth(['owner', 'admin']));

/* ---------- Dashboard summary ---------- */
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

/* ---------- Categories ---------- */
router.get('/categories', async (_req, res) => {
  const r = await query("SELECT * FROM categories ORDER BY name");
  res.json({ success: true, data: r.rows });
});

router.post('/categories', async (req, res) => {
  const { name, slug, is_active = true } = req.body || {};
  if (!name || !slug) return res.status(400).json({ success: false, message: 'name and slug required' });
  const r = await query(
    "INSERT INTO categories (name, slug, is_active) VALUES ($1,$2,$3) RETURNING *",
    [name, slug, !!is_active]
  );
  res.status(201).json({ success: true, data: r.rows[0] });
});

router.put('/categories/:id', async (req, res) => {
  const { name, slug, is_active } = req.body || {};
  const r = await query(
    "UPDATE categories SET name = COALESCE($2,name), slug = COALESCE($3,slug), is_active = COALESCE($4,is_active) WHERE id = $1 RETURNING *",
    [req.params.id, name ?? null, slug ?? null, typeof is_active === 'boolean' ? is_active : null]
  );
  if (!r.rows.length) return res.status(404).json({ success: false });
  res.json({ success: true, data: r.rows[0] });
});

router.delete('/categories/:id', async (req, res) => {
  await query("DELETE FROM categories WHERE id = $1", [req.params.id]);
  res.json({ success: true });
});

/* ---------- Products ---------- */
router.get('/products', async (_req, res) => {
  const r = await query(`
    SELECT p.*, c.name AS category_name,
           (SELECT COUNT(*) FROM product_stocks s WHERE s.product_id = p.id AND s.status='available') AS stock_count
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    ORDER BY p.created_at DESC LIMIT 200
  `);
  res.json({ success: true, data: r.rows });
});

router.post('/products', async (req, res) => {
  const { name, slug, description, price, product_type, category_id, stock_type, is_active = true } = req.body || {};
  if (!name || !slug || price == null || !product_type) {
    return res.status(400).json({ success: false, message: 'name, slug, price, product_type required' });
  }
  const r = await query(
    `INSERT INTO products (name, slug, description, price, product_type, category_id, stock_type, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'manual'),$8) RETURNING *`,
    [name, slug, description || null, price, product_type, category_id || null, stock_type || null, !!is_active]
  );
  res.status(201).json({ success: true, data: r.rows[0] });
});

router.put('/products/:id', async (req, res) => {
  const f = req.body || {};
  const r = await query(
    `UPDATE products SET
       name = COALESCE($2,name),
       slug = COALESCE($3,slug),
       description = COALESCE($4,description),
       price = COALESCE($5,price),
       product_type = COALESCE($6,product_type),
       category_id = COALESCE($7,category_id),
       stock_type = COALESCE($8,stock_type),
       is_active = COALESCE($9,is_active),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [req.params.id, f.name ?? null, f.slug ?? null, f.description ?? null, f.price ?? null,
     f.product_type ?? null, f.category_id ?? null, f.stock_type ?? null,
     typeof f.is_active === 'boolean' ? f.is_active : null]
  );
  if (!r.rows.length) return res.status(404).json({ success: false });
  res.json({ success: true, data: r.rows[0] });
});

router.delete('/products/:id', async (req, res) => {
  await query("DELETE FROM products WHERE id = $1", [req.params.id]);
  res.json({ success: true });
});

/* ---------- Settings ---------- */
router.get('/settings', async (_req, res) => {
  res.json({ success: true, data: await listSettings(), known_keys: KEYS });
});

router.get('/settings/:key', async (req, res) => {
  const v = await getSetting(req.params.key);
  res.json({ success: true, key: req.params.key, value: v });
});

router.put('/settings/:key', async (req, res) => {
  const { value, secret } = req.body || {};
  if (value === undefined) return res.status(400).json({ success: false, message: 'value required' });
  await setSetting(req.params.key, value, { secret: !!secret });
  res.json({ success: true, key: req.params.key });
});

/* ---------- Orders ---------- */
router.get('/orders', async (_req, res) => {
  const r = await query(
    "SELECT id, order_no, buyer_name, buyer_email, total_amount, status, payment_status, created_at, paid_at FROM orders ORDER BY created_at DESC LIMIT 200"
  );
  res.json({ success: true, data: r.rows });
});

module.exports = router;
