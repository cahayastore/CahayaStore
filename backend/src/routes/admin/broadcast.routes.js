'use strict';
/* ════════════════════════════════════════════════════════════════════
   Admin broadcast — send a message to all Telegram bot users.
   Rate-limited to stay within Telegram's ~30 msg/sec limit.
   Routes are mounted under /api/admin (auth enforced by admin/index.js).
   ════════════════════════════════════════════════════════════════════ */
const express = require('express');
const { query } = require('../../db');

const router = express.Router();

// In-memory state of the most recent broadcast (single-flight).
let current = null; // { id, total, sent, failed, status, startedAt, finishedAt, text }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* GET /api/admin/broadcast/audience — how many users will receive it. */
router.get('/broadcast/audience', async (_req, res) => {
  const r = await query("SELECT count(*)::int AS n FROM users WHERE telegram_id IS NOT NULL");
  res.json({ success: true, data: { recipients: r.rows[0].n } });
});

/* GET /api/admin/broadcast/status — progress of the running/last broadcast. */
router.get('/broadcast/status', (_req, res) => {
  res.json({ success: true, data: current || { status: 'idle' } });
});

/* POST /api/admin/broadcast — start a broadcast.
   body: { text: string, parseMode?: 'HTML'|'none', imageUrl?: string, voucherCode?: string } */
router.post('/broadcast', async (req, res) => {
  const text = String((req.body && req.body.text) || '').trim();
  const imageUrl = String((req.body && req.body.imageUrl) || '').trim() || null;
  const voucherCode = String((req.body && req.body.voucherCode) || '').trim().toUpperCase() || null;
  // With an image, the text becomes the caption (max 1024). Without, max 4000.
  if (!text && !imageUrl) return res.status(400).json({ success: false, message: 'Teks atau gambar wajib diisi.' });
  const maxLen = imageUrl ? 1024 : 4000;
  if (text.length > maxLen) {
    return res.status(400).json({ success: false, message: `Pesan maksimal ${maxLen} karakter${imageUrl ? ' (karena ada gambar)' : ''}.` });
  }
  if (current && current.status === 'running') {
    return res.status(409).json({ success: false, message: 'Broadcast lain sedang berjalan.' });
  }

  const parseMode = (req.body && req.body.parseMode) === 'none' ? null : 'HTML';

  // Snapshot the recipient list (distinct telegram_id, skip nulls).
  const r = await query(
    "SELECT DISTINCT telegram_id FROM users WHERE telegram_id IS NOT NULL"
  );
  const recipients = r.rows.map((x) => String(x.telegram_id)).filter(Boolean);

  current = {
    id: Date.now().toString(36),
    total: recipients.length,
    sent: 0,
    failed: 0,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    text,
  };
  const job = current;

  // Respond immediately; run the send loop in the background.
  res.json({ success: true, data: { id: job.id, total: job.total, status: job.status } });

  (async () => {
    const { sendMessage, sendPhoto } = require('../../telegram/bot-loader');
    const baseOpts = parseMode ? { parse_mode: parseMode } : { parse_mode: undefined };
    // Optional inline button that opens the voucher redeem prompt.
    let reply_markup;
    if (voucherCode) {
      reply_markup = { inline_keyboard: [[{ text: '🎟️ Tukar Voucher Sekarang', callback_data: 'menu:voucher' }]] };
    }
    const opts = { ...baseOpts, ...(reply_markup ? { reply_markup } : {}) };
    for (const chatId of recipients) {
      if (job.status === 'cancelled') break;
      try {
        if (imageUrl) {
          await sendPhoto(chatId, imageUrl, text, opts);
        } else {
          await sendMessage(chatId, text, opts);
        }
        job.sent += 1;
      } catch (e) {
        job.failed += 1;
        // 429 → respect retry_after; otherwise just continue.
        const after = e && e.parameters && e.parameters.retry_after;
        if (after) await sleep((Number(after) + 1) * 1000);
      }
      // ~20 messages/sec to stay safely under Telegram's limit.
      await sleep(50);
    }
    if (job.status !== 'cancelled') job.status = 'done';
    job.finishedAt = new Date().toISOString();
    try {
      await query(
        "INSERT INTO audit_logs (action, entity_type, entity_id, metadata) VALUES ('broadcast.sent','broadcast',NULL,$1)",
        [JSON.stringify({ total: job.total, sent: job.sent, failed: job.failed, image: !!imageUrl, voucher: voucherCode || null })]
      );
    } catch (e) { /* audit best-effort */ }
  })().catch((e) => {
    job.status = 'error';
    job.error = e.message;
    job.finishedAt = new Date().toISOString();
    console.error('[broadcast]', e);
  });
});

/* POST /api/admin/broadcast/cancel — stop the running broadcast. */
router.post('/broadcast/cancel', (_req, res) => {
  if (current && current.status === 'running') {
    current.status = 'cancelled';
    return res.json({ success: true, data: { status: 'cancelled' } });
  }
  res.json({ success: true, data: { status: current ? current.status : 'idle' } });
});

module.exports = router;
