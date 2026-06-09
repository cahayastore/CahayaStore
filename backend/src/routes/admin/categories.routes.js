'use strict';
const express = require('express');
const { query } = require('../../db');

const router = express.Router();

router.get('/categories', async (_req, res) => {
  const r = await query("SELECT * FROM categories ORDER BY name");
  res.json({ success: true, data: r.rows });
});

router.post('/categories', async (req, res) => {
  const { name, slug, image_url, is_active = true } = req.body || {};
  if (!name || !slug) return res.status(400).json({ success: false, message: 'name and slug required' });
  const r = await query(
    "INSERT INTO categories (name, slug, image_url, is_active) VALUES ($1,$2,$3,$4) RETURNING *",
    [name, slug, image_url || null, !!is_active]
  );
  res.status(201).json({ success: true, data: r.rows[0] });
});

router.put('/categories/:id', async (req, res) => {
  const { name, slug, image_url, is_active } = req.body || {};
  const r = await query(
    `UPDATE categories SET
       name = COALESCE($2,name),
       slug = COALESCE($3,slug),
       image_url = $4,
       is_active = COALESCE($5,is_active)
     WHERE id = $1 RETURNING *`,
    [req.params.id, name ?? null, slug ?? null, image_url ?? null, typeof is_active === 'boolean' ? is_active : null]
  );
  if (!r.rows.length) return res.status(404).json({ success: false });
  res.json({ success: true, data: r.rows[0] });
});

router.delete('/categories/:id', async (req, res) => {
  await query("DELETE FROM categories WHERE id = $1", [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
