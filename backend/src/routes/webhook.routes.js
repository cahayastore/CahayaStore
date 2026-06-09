'use strict';
const express = require('express');
const { query, tx } = require('../db');
const { verifyPayhookToken } = require('../payment/myqris.service');
const { getSetting, KEYS } = require('../settings.service');
const { safeEqual } = require('../crypto');

const router = express.Router();

/*
 * Mount this router with raw body parser BEFORE express.json.
 * Raw parser uses a wildcard type so JSON and form bodies both arrive as Buffer.
 */

// Deliver stock for a paid order (assign one available item per order item).
async function deliverOrder(client, orderId) {
  const oi = await client.query(
    "SELECT id, product_id FROM order_items WHERE order_id = $1",
    [orderId]
  );
  for (const item of oi.rows) {
    const stock = await client.query(
      `SELECT id FROM product_stocks
        WHERE product_id = $1 AND status = 'available'
        ORDER BY created_at ASC
        LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [item.product_id]
    );
    if (stock.rows.length) {
      const stockId = stock.rows[0].id;
      await client.query("UPDATE product_stocks SET status='sold', sold_at=now() WHERE id = $1", [stockId]);
      await client.query("UPDATE order_items SET delivered_stock_id = $2 WHERE id = $1", [item.id, stockId]);
    }
  }
  await client.query(
    "INSERT INTO deliveries (order_id, delivery_type, status) VALUES ($1, 'manual', 'delivered')",
    [orderId]
  );
}

/*
 * PayHook webhook — POST /api/webhooks/myqris
 * PayHook (Android app) forwards bank/e-wallet notifications. It posts the
 * received transaction amount + a shared token. We match a pending payment by
 * exact amount, mark it paid, and deliver the product.
 *
 * Accepts JSON or form-encoded body. Fields (flexible):
 *   amount | nominal | jumlah   → number (required)
 *   token  | secret  | key      → shared token (or header X-PayHook-Token)
 *   order_ref | order_no        → optional explicit match
 */
router.post('/myqris', async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  let payload = {};
  try { payload = JSON.parse(rawBody); }
  catch {
    // try form-encoded
    try { payload = Object.fromEntries(new URLSearchParams(rawBody)); } catch { payload = {}; }
  }

  const provided = req.header('x-payhook-token') || req.header('x-webhook-token')
    || payload.token || payload.secret || payload.key || '';

  let verify;
  try { verify = await verifyPayhookToken(provided); }
  catch (e) { return res.status(503).json({ success: false, message: e.message }); }
  if (!verify.ok) {
    console.warn('[payhook] invalid token', verify.reason);
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }

  const orderRef = payload.order_ref || payload.order_no || null;
  const amount = Number(payload.amount || payload.nominal || payload.jumlah || 0);
  if (!orderRef && !(amount > 0)) {
    return res.status(400).json({ success: false, message: 'amount atau order_ref wajib diisi.' });
  }

  try {
    const result = await tx(async (client) => {
      // Find target pending order: by ref, else by exact pending amount (newest first).
      let o;
      if (orderRef) {
        o = await client.query("SELECT * FROM orders WHERE order_no = $1 FOR UPDATE", [orderRef]);
      } else {
        o = await client.query(
          `SELECT o.* FROM orders o
             JOIN payments p ON p.order_id = o.id
            WHERE o.payment_status = 'pending' AND p.status = 'pending' AND p.amount = $1
            ORDER BY o.created_at DESC
            LIMIT 1 FOR UPDATE`,
          [amount]
        );
      }
      if (!o.rows.length) return { matched: false };
      const order = o.rows[0];
      if (order.payment_status === 'paid') return { matched: true, already: true, orderNo: order.order_no };

      await client.query(
        "UPDATE payments SET status='paid', paid_at=now(), raw_payload=$2 WHERE order_id=$1",
        [order.id, payload]
      );
      await client.query(
        "UPDATE orders SET payment_status='paid', status='paid', paid_at=now(), updated_at=now() WHERE id=$1",
        [order.id]
      );
      await deliverOrder(client, order.id);
      await client.query(
        "INSERT INTO audit_logs (action, entity_type, entity_id, metadata) VALUES ('payment.paid','order',$1,$2)",
        [order.id, payload]
      );
      return { matched: true, orderNo: order.order_no };
    });

    if (!result.matched) {
      return res.status(404).json({ success: false, message: 'Tidak ada order pending yang cocok.' });
    }
    res.json({ success: true, orderId: result.orderNo, already: !!result.already });
  } catch (e) {
    console.error('[payhook]', e);
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
