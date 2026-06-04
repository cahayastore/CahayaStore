'use strict';
const express = require('express');
const { query, tx } = require('../db');
const { verifyWebhookSignature } = require('../payment/myqris.service');
const { getSetting, KEYS } = require('../settings.service');
const { safeEqual } = require('../crypto');

const router = express.Router();

/**
 * Mount this router with raw body parser BEFORE express.json:
 *   app.use('/api/webhooks', express.raw({ type: '*/*', limit: '1mb' }), webhookRouter)
 */

router.post('/myqris', async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const sig = req.header('x-signature') || req.header('X-Signature') || '';
  let verify;
  try {
    verify = await verifyWebhookSignature(rawBody, sig);
  } catch (e) {
    return res.status(503).json({ success: false, message: e.message });
  }
  if (!verify.ok) {
    console.warn('[webhook myqris] invalid signature', verify.reason);
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return res.status(400).json({ success: false, message: 'Bad JSON' }); }
  const { order_ref, payment_ref, status, paid_at } = payload || {};
  if (!order_ref && !payment_ref) {
    return res.status(400).json({ success: false, message: 'order_ref or payment_ref required' });
  }
  try {
    await tx(async (client) => {
      const o = await client.query(
        "SELECT * FROM orders WHERE order_no = $1 FOR UPDATE",
        [order_ref || payment_ref]
      );
      if (!o.rows.length) return;
      const order = o.rows[0];
      const newPaid = String(status).toLowerCase() === 'paid';
      if (newPaid && order.payment_status !== 'paid') {
        await client.query(
          "UPDATE payments SET status='paid', paid_at = COALESCE($2, now()), raw_payload = $3 WHERE order_id = $1",
          [order.id, paid_at ? new Date(paid_at) : null, payload]
        );
        await client.query(
          "UPDATE orders SET payment_status='paid', status='paid', paid_at = COALESCE($2, now()), updated_at = now() WHERE id = $1",
          [order.id, paid_at ? new Date(paid_at) : null]
        );
        await client.query(
          "INSERT INTO deliveries (order_id, delivery_type, status) VALUES ($1, 'manual', 'pending')",
          [order.id]
        );
        await client.query(
          "INSERT INTO audit_logs (action, entity_type, entity_id, metadata) VALUES ('payment.paid','order',$1,$2)",
          [order.id, payload]
        );
      }
    });
    res.json({ success: true });
  } catch (e) {
    console.error('[webhook myqris]', e);
    res.status(500).json({ success: false });
  }
});

/* Telegram webhook (per-bot id), HMAC secret stored in settings */
router.post('/telegram/:botId', async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const provided = req.header('x-telegram-bot-api-secret-token') || '';
  const cfg = await getSetting(KEYS.TELEGRAM_BOT).catch(() => null);
  if (!cfg || !cfg.webhook_secret) {
    return res.status(503).json({ success: false, message: 'Telegram bot not configured' });
  }
  if (!safeEqual(provided, cfg.webhook_secret)) {
    return res.status(401).json({ success: false, message: 'Invalid secret' });
  }
  // Forward to bot loader (best-effort, never fail Telegram delivery)
  try {
    const { handleUpdate } = require('../telegram/bot-loader');
    const update = JSON.parse(rawBody);
    handleUpdate(req.params.botId, update).catch(err => console.error('[tg handler]', err));
  } catch (e) {
    console.error('[telegram webhook]', e);
  }
  res.json({ ok: true });
});

module.exports = router;
