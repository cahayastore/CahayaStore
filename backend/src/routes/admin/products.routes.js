'use strict';
const express = require('express');
const { query } = require('../../db');

const router = express.Router();

/* Slugify a string into a URL-safe slug. */
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/* Return a slug unique within products. Appends -2, -3, ... on collision.
   `excludeId` lets edit keep its own slug. */
async function uniqueSlug(base, excludeId = null) {
  let root = slugify(base) || 'produk';
  let candidate = root;
  let n = 1;
  // Loop until no other product owns the candidate slug.
  // Bounded by a sane cap to avoid infinite loops.
  for (let i = 0; i < 200; i += 1) {
    const r = await query(
      'SELECT id FROM products WHERE slug = $1 AND ($2::uuid IS NULL OR id <> $2) LIMIT 1',
      [candidate, excludeId]
    );
    if (!r.rows.length) return candidate;
    n += 1;
    candidate = `${root}-${n}`;
  }
  return `${root}-${Date.now()}`;
}

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
  try {
    const { name, slug, description, price, original_price, image_url, product_type, category_id, stock_type, is_active = true } = req.body || {};
    if (!name || price == null || !product_type) {
      return res.status(400).json({ success: false, message: 'name, price, dan product_type wajib diisi.' });
    }
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return res.status(400).json({ success: false, message: 'Harga harus angka >= 0.' });
    }
    // Slug auto-generated from name when not supplied, and always made unique.
    const finalSlug = await uniqueSlug(slug || name);
    const r = await query(
      `INSERT INTO products (name, slug, description, price, original_price, image_url, product_type, category_id, stock_type, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'manual'),$10) RETURNING *`,
      [name, finalSlug, description || null, priceNum, original_price || null, image_url || null, product_type, category_id || null, stock_type || null, !!is_active]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ success: false, message: 'Slug sudah dipakai produk lain.' });
    }
    console.error('[products.create]', e);
    res.status(500).json({ success: false, message: 'Gagal menyimpan produk.' });
  }
});

router.put('/products/:id', async (req, res) => {
  try {
    const f = req.body || {};
    // If a slug is provided, normalize + ensure unique (excluding this product).
    // If name changes but slug omitted, keep existing slug (no surprise URL changes).
    let slug = null;
    if (f.slug != null && String(f.slug).trim() !== '') {
      slug = await uniqueSlug(f.slug, req.params.id);
    }
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
      [req.params.id, f.name ?? null, slug, f.description ?? null, f.price ?? null,
       f.original_price ?? null, f.image_url ?? null,
       f.product_type ?? null, f.category_id ?? null, f.stock_type ?? null,
       typeof f.is_active === 'boolean' ? f.is_active : null]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Produk tidak ditemukan.' });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ success: false, message: 'Slug sudah dipakai produk lain.' });
    }
    console.error('[products.update]', e);
    res.status(500).json({ success: false, message: 'Gagal memperbarui produk.' });
  }
});

router.delete('/products/:id', async (req, res) => {
  await query("DELETE FROM products WHERE id = $1", [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
