'use strict';
/* ════════════════════════════════════════════════════════════════════
   Admin broadcast — send a message to all Telegram bot users.
   Persistent: jobs stored in broadcast_jobs, survive tab close + restarts.
   Routes are mounted under /api/admin (auth enforced by admin/index.js).
   ════════════════════════════════════════════════════════════════════ */
const express = require('express');
const broadcast = require('../../broadcast.service');

const router = express.Router();

/* GET /api/admin/broadcast/audience — how many users will receive it. */
router.get('/broadcast/audience', async (_req, res) => {
  try {
    const recipients = await broadcast.countRecipients();
    res.json({ success: true, data: { recipients } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/* GET /api/admin/broadcast/status — progress of the running/last broadcast. */
router.get('/broadcast/status', async (_req, res) => {
  try {
    const data = await broadcast.getStatus();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/* POST /api/admin/broadcast — start a broadcast.
   body: { text, parseMode?: 'HTML'|'none', imageUrl?, voucherCode? } */
router.post('/broadcast', async (req, res) => {
  const text = String((req.body && req.body.text) || '').trim();
  const imageUrl = String((req.body && req.body.imageUrl) || '').trim() || null;
  const voucherCode = String((req.body && req.body.voucherCode) || '').trim().toUpperCase() || null;
  if (!text && !imageUrl) return res.status(400).json({ success: false, message: 'Teks atau gambar wajib diisi.' });
  const maxLen = imageUrl ? 1024 : 4000;
  if (text.length > maxLen) {
    return res.status(400).json({ success: false, message: `Pesan maksimal ${maxLen} karakter${imageUrl ? ' (karena ada gambar)' : ''}.` });
  }
  const parseMode = (req.body && req.body.parseMode) === 'none' ? 'none' : 'HTML';

  try {
    const job = await broadcast.startJob({ text, imageUrl, voucherCode, parseMode });
    res.json({ success: true, data: job });
  } catch (e) {
    if (e.code === 'BUSY') return res.status(409).json({ success: false, message: e.message });
    res.status(500).json({ success: false, message: e.message });
  }
});

/* POST /api/admin/broadcast/cancel — stop the running broadcast. */
router.post('/broadcast/cancel', async (_req, res) => {
  try {
    const r = await broadcast.cancel();
    res.json({ success: true, data: { status: r.cancelled ? 'cancelled' : 'idle' } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
