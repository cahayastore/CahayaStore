'use strict';
/* Admin voucher management. Mounted under /api/admin (auth enforced upstream). */
const express = require('express');
const voucher = require('../../voucher.service');

const router = express.Router();

router.get('/vouchers', async (_req, res) => {
  try {
    const data = await voucher.listVouchers(200);
    res.json({ success: true, data });
  } catch (e) {
    console.error('[vouchers list]', e);
    res.status(500).json({ success: false, message: 'Gagal memuat voucher.' });
  }
});

router.post('/vouchers', async (req, res) => {
  try {
    const { code, amount, maxUses, perUserLimit, expiresAt, note } = req.body || {};
    const v = await voucher.createVoucher({ code, amount, maxUses, perUserLimit, expiresAt, note });
    res.status(201).json({ success: true, data: v });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ success: false, message: 'Kode voucher sudah dipakai.' });
    res.status(400).json({ success: false, message: e.message || 'Gagal membuat voucher.' });
  }
});

router.put('/vouchers/:id/active', async (req, res) => {
  try {
    const v = await voucher.setVoucherActive(req.params.id, !!(req.body && req.body.active));
    if (!v) return res.status(404).json({ success: false, message: 'Voucher tidak ditemukan.' });
    res.json({ success: true, data: v });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

router.delete('/vouchers/:id', async (req, res) => {
  try {
    await voucher.deleteVoucher(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

module.exports = router;
