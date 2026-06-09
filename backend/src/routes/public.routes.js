'use strict';
const express = require('express');
const { query } = require('../db');
const { getSetting, KEYS } = require('../settings.service');

const router = express.Router();

router.get('/banners', async (_req, res) => {
  const value = await getSetting(KEYS.STORE_BANNERS);
  const items = Array.isArray(value?.items) ? value.items : [];
  const banners = items
    .filter((b) => b && b.active !== false && b.image_url)
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    .map((b) => ({
      id: String(b.id || ''),
      image_url: String(b.image_url),
      link: b.link ? String(b.link) : null,
      alt: b.alt ? String(b.alt) : ''
    }));
  res.json({ success: true, data: banners });
});

router.get('/categories', async (_req, res) => {
  const r = await query(
    "SELECT id, name, slug, image_url FROM categories WHERE is_active = TRUE ORDER BY name"
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
    SELECT p.id, p.name, p.slug, p.description, p.price, p.original_price,
           COALESCE(p.image_url, c.image_url) AS image_url, p.product_type,
           c.name AS category_name, c.slug AS category_slug,
           (SELECT COUNT(*) FROM product_stocks s WHERE s.product_id = p.id AND s.status = 'available') AS stock_count,
           (SELECT COUNT(*) FROM product_stocks s WHERE s.product_id = p.id AND s.status = 'sold') AS sold_count
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
    `SELECT p.id, p.name, p.slug, p.description, p.price, p.original_price,
            COALESCE(p.image_url, c.image_url) AS image_url, p.product_type,
            c.name AS category_name, c.slug AS category_slug,
            (SELECT COUNT(*) FROM product_stocks s WHERE s.product_id = p.id AND s.status = 'available') AS stock_count,
            (SELECT COUNT(*) FROM product_stocks s WHERE s.product_id = p.id AND s.status = 'sold') AS sold_count
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.slug = $1 AND p.is_active = TRUE`,
    [req.params.slug]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data: r.rows[0] });
});

module.exports = router;
