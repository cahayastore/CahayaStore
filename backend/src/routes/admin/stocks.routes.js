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

/* Render a stock-alert template with simple {placeholders}. */
function renderTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/* Best-effort: when stock is added, broadcast a notice to all bot users if the
   stock-alert feature is enabled in settings. Never blocks/breaks the request. */
async function maybeBroadcastStockAdded(productId, addedCount) {
  try {
    const { getSetting, KEYS } = require('../../settings.service');
    const cfg = await getSetting(KEYS.STOCK_ALERT);
    if (!cfg || !cfg.enabled || !cfg.template) return;

    const pr = await query(
      `SELECT p.name, p.price,
              count(s.id) FILTER (WHERE s.status='available') AS stock
         FROM products p LEFT JOIN product_stocks s ON s.product_id = p.id
        WHERE p.id = $1 GROUP BY p.id`,
      [productId]
    );
    if (!pr.rows.length) return;
    const p = pr.rows[0];
    const rupiah = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
    const text = renderTemplate(cfg.template, {
      produk: p.name,
      nama: p.name,
      harga: rupiah(p.price),
      stok: String(p.stock),
      jumlah: String(addedCount),
    });

    const broadcast = require('../../broadcast.service');
    await broadcast.startJob({
      text,
      imageUrl: (cfg.imageUrl || '').trim() || null,
      parseMode: 'HTML',
    });
  } catch (e) {
    console.error('[stock alert broadcast]', e.message);
  }
}

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

  // Fire-and-forget: notify users that stock was added (if enabled).
  maybeBroadcastStockAdded(productId, inserted.length);
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
