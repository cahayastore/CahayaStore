'use strict';
/* ════════════════════════════════════════════════════════════════════
   Admin — Product Stocks
   Endpoint:
     GET    /api/admin/products/:id/stocks         → list (encrypted_content disensor)
     POST   /api/admin/products/:id/stocks         → bulk insert (array items)
     DELETE /api/admin/products/:id/stocks/:stockId
   Content type yang valid: 'file' | 'credential' | 'code' | 'note'
   ════════════════════════════════════════════════════════════════════ */
const express = require('express');
const { query } = require('../../db');
const { encryptString } = require('../../crypto');

const router = express.Router();
const CONTENT_TYPES = new Set(['file', 'credential', 'code', 'note']);

/* List */
router.get('/products/:id/stocks', async (req, res) => {
  const r = await query(
    `SELECT id, content_type, status, file_path, created_at, sold_at,
            CASE WHEN encrypted_content IS NOT NULL THEN '••• terenkripsi •••' END AS preview
       FROM product_stocks
      WHERE product_id = $1
      ORDER BY created_at DESC
      LIMIT 500`,
    [req.params.id]
  );
  res.json({ success: true, data: r.rows });
});

/**
 * Bulk insert.
 * Body:
 *   { content_type: 'code'|'credential'|'note', items: ['ABCD-1234', ...] }
 *   atau:
 *   { items: [{ content_type, content }, ...] }
 */
router.post('/products/:id/stocks', async (req, res) => {
  const productId = req.params.id;
  const body = req.body || {};

  // Pastikan produk ada
  const p = await query('SELECT id FROM products WHERE id = $1', [productId]);
  if (!p.rows.length) {
    return res.status(404).json({ success: false, message: 'Produk tidak ditemukan' });
  }

  // Normalisasi items menjadi [{ content_type, content }]
  let items = [];
  if (Array.isArray(body.items)) {
    if (body.content_type) {
      if (!CONTENT_TYPES.has(body.content_type)) {
        return res.status(400).json({ success: false, message: 'content_type tidak valid' });
      }
      items = body.items
        .map((s) => (typeof s === 'string' ? s.trim() : ''))
        .filter(Boolean)
        .map((s) => ({ content_type: body.content_type, content: s }));
    } else {
      items = body.items
        .filter((x) => x && typeof x === 'object')
        .map((x) => ({
          content_type: String(x.content_type || '').trim(),
          content: String(x.content || '').trim(),
        }))
        .filter((x) => CONTENT_TYPES.has(x.content_type) && x.content);
    }
  }

  if (!items.length) {
    return res.status(400).json({ success: false, message: 'Tidak ada item stok yang valid' });
  }
  if (items.length > 500) {
    return res.status(400).json({ success: false, message: 'Maksimal 500 item per request' });
  }

  // Insert satu per satu (cukup untuk skala awal Cahaya Store)
  const inserted = [];
  for (const it of items) {
    const enc = encryptString(it.content);
    const r = await query(
      `INSERT INTO product_stocks (product_id, content_type, encrypted_content, status)
       VALUES ($1, $2, $3, 'available')
       RETURNING id, content_type, status, created_at`,
      [productId, it.content_type, enc]
    );
    inserted.push(r.rows[0]);
  }

  res.status(201).json({ success: true, count: inserted.length, data: inserted });
});

/* Delete single stock (only if not sold) */
router.delete('/products/:id/stocks/:stockId', async (req, res) => {
  const r = await query(
    `DELETE FROM product_stocks
      WHERE id = $1 AND product_id = $2 AND status <> 'sold'
      RETURNING id`,
    [req.params.stockId, req.params.id]
  );
  if (!r.rows.length) {
    return res.status(400).json({ success: false, message: 'Stok tidak ditemukan atau sudah terjual' });
  }
  res.json({ success: true });
});

module.exports = router;
