'use strict';
const express = require('express');
const { query } = require('../../db');

const router = express.Router();

router.get('/products', async (_req, res) => {
  const r = await query(`
    SELECT p.*, c.name AS category_name,
           (SELECT COUNT(*) FROM product_stocks s WHERE s.product_id = p.id AND s.status='available') AS stock_count
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    ORDER BY p.created_at DESC
    LIMIT 200
  `);
  res.json({ success: true, data: r.rows });
});

router.post('/products', async (req, res) => {
  const { name, slug, description, price, original_price, image_url, product_type, category_id, stock_type, is_active = true } = req.body || {};
  if (!name || !slug || price == null || !product_type) {
    return res.status(400).json({ success: false, message: 'name, slug, price, product_type required' });
  }
  const r = await query(
    `INSERT INTO products (name, slug, description, price, original_price, image_url, product_type, category_id, stock_type, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'manual'),$10) RETURNING *`,
    [name, slug, description || null, price, original_price || null, image_url || null, product_type, category_id || null, stock_type || null, !!is_active]
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
       original_price = $6,
       image_url = $7,
       product_type = COALESCE($8,product_type),
       category_id = COALESCE($9,category_id),
       stock_type = COALESCE($10,stock_type),
       is_active = COALESCE($11,is_active),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [req.params.id, f.name ?? null, f.slug ?? null, f.description ?? null, f.price ?? null,
     f.original_price ?? null, f.image_url ?? null,
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

module.exports = router;
