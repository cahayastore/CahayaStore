'use strict';
const express = require('express');
const { query } = require('../db');

const router = express.Router();

router.get('/categories', async (_req, res) => {
  const r = await query(
    "SELECT id, name, slug FROM categories WHERE is_active = TRUE ORDER BY name"
  );
  res.json({ success: true, data: r.rows });
});

router.get('/products', async (req, res) => {
  const { category, q, type } = req.query;
  const params = [];
  const where = ['p.is_active = TRUE'];
  if (category) {
    params.push(String(category));
    where.push(`c.slug = $${params.length}`);
  }
  if (type) {
    params.push(String(type));
    where.push(`p.product_type = $${params.length}`);
  }
  if (q) {
    params.push(`%${String(q).toLowerCase()}%`);
    where.push(`LOWER(p.name) LIKE $${params.length}`);
  }
  const sql = `
    SELECT p.id, p.name, p.slug, p.description, p.price, p.product_type,
           c.name AS category_name, c.slug AS category_slug,
           (SELECT COUNT(*) FROM product_stocks s WHERE s.product_id = p.id AND s.status = 'available') AS stock_count
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE ${where.join(' AND ')}
    ORDER BY p.created_at DESC
    LIMIT 100
  `;
  const r = await query(sql, params);
  res.json({ success: true, data: r.rows });
});

router.get('/products/:slug', async (req, res) => {
  const r = await query(
    `SELECT p.id, p.name, p.slug, p.description, p.price, p.product_type,
            c.name AS category_name, c.slug AS category_slug,
            (SELECT COUNT(*) FROM product_stocks s WHERE s.product_id = p.id AND s.status = 'available') AS stock_count
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.slug = $1 AND p.is_active = TRUE`,
    [req.params.slug]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data: r.rows[0] });
});

module.exports = router;
