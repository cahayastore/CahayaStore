'use strict';
const express = require('express');
const { getSetting, setSetting, listSettings, KEYS } = require('../../settings.service');

const router = express.Router();

router.get('/settings', async (_req, res) => {
  res.json({ success: true, data: await listSettings(), known_keys: KEYS });
});

router.get('/settings/:key', async (req, res) => {
  const v = await getSetting(req.params.key);
  res.json({ success: true, key: req.params.key, value: v });
});

router.put('/settings/:key', async (req, res) => {
  const { value, secret } = req.body || {};
  if (value === undefined) {
    return res.status(400).json({ success: false, message: 'value required' });
  }
  await setSetting(req.params.key, value, { secret: !!secret });

  // When the Telegram bot config changes, refresh the cached bot + (re)register
  // the webhook so Telegram knows where to deliver updates.
  let telegram;
  if (req.params.key === KEYS.TELEGRAM_BOT) {
    try {
      const loader = require('../../telegram/bot-loader');
      loader.clearCache();
      if (value && value.token && value.webhook_secret) {
        telegram = await loader.registerWebhook();
      } else {
        telegram = { ok: false, reason: 'token_or_secret_missing' };
      }
    } catch (e) {
      console.error('[settings telegram register]', e);
      telegram = { ok: false, error: e.message };
    }
  }

  res.json({ success: true, key: req.params.key, telegram });
});

/* Telegram webhook status (getWebhookInfo + getMe). */
router.get('/telegram/status', async (_req, res) => {
  try {
    const cfg = await getSetting(KEYS.TELEGRAM_BOT);
    if (!cfg || !cfg.token) {
      return res.json({ success: true, configured: false });
    }
    const { Bot } = require('grammy');
    const bot = new Bot(cfg.token);
    const [me, info] = await Promise.all([bot.api.getMe(), bot.api.getWebhookInfo()]);
    res.json({
      success: true,
      configured: true,
      bot: { id: me.id, username: me.username },
      webhook: {
        url: info.url || null,
        pending: info.pending_update_count,
        lastError: info.last_error_message || null,
      },
    });
  } catch (e) {
    res.status(502).json({ success: false, message: e.message });
  }
});

/* Manually (re)register the Telegram webhook. */
router.post('/telegram/register', async (_req, res) => {
  try {
    const loader = require('../../telegram/bot-loader');
    loader.clearCache();
    const r = await loader.registerWebhook();
    res.json({ success: true, ...r });
  } catch (e) {
    res.status(502).json({ success: false, message: e.message });
  }
});

/* Send a test notification to the configured admin chat. */
router.post('/telegram/test', async (_req, res) => {
  try {
    const cfg = await getSetting(KEYS.TELEGRAM_BOT);
    if (!cfg || !cfg.token) return res.status(400).json({ success: false, message: 'Bot belum dikonfigurasi.' });
    if (!cfg.admin_chat_id) return res.status(400).json({ success: false, message: 'Admin Chat ID belum diisi.' });
    const loader = require('../../telegram/bot-loader');
    await loader.sendMessage(cfg.admin_chat_id,
      '🔔 <b>Tes notifikasi Cahaya Store</b>\nJika kamu menerima pesan ini, notifikasi pembayaran sudah aktif.');
    res.json({ success: true });
  } catch (e) {
    res.status(502).json({ success: false, message: e.message });
  }
});

module.exports = router;
