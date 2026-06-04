'use strict';
const { getSetting, KEYS } = require('../settings.service');
const { hmacSha256, safeEqual } = require('../crypto');

/**
 * MyQRIS service stub.
 * Real integration will call MyQRIS create-invoice API.
 * For now we generate a static QR payload reference based on configured qris_static
 * so the flow (order -> payment record -> webhook) can be exercised end-to-end.
 */

async function loadConfig() {
  const cfg = await getSetting(KEYS.MYQRIS);
  if (!cfg) {
    const err = new Error('MyQRIS not configured. Set it in /admin/settings.');
    err.code = 'MYQRIS_NOT_CONFIGURED';
    throw err;
  }
  return cfg;
}

async function createInvoice({ orderNo, amount }) {
  const cfg = await loadConfig();
  // Real impl: HTTP call to MyQRIS create-invoice endpoint with api_key + amount + ref=orderNo.
  // Placeholder: return the configured static QR payload + reference id.
  return {
    provider: 'myqris',
    payment_ref: `${cfg.merchant_id || 'MERCHANT'}-${orderNo}`,
    qr_payload: cfg.qris_static || null,
    amount,
    raw: null
  };
}

/**
 * Verify webhook signature.
 * Convention (until real provider docs land): X-Signature = HMAC-SHA256(webhook_secret, rawBody)
 */
async function verifyWebhookSignature(rawBody, signatureHeader) {
  const cfg = await loadConfig();
  if (!cfg.webhook_secret) return { ok: false, reason: 'no_secret' };
  if (!signatureHeader) return { ok: false, reason: 'no_signature' };
  const expected = hmacSha256(cfg.webhook_secret, rawBody);
  return { ok: safeEqual(expected, signatureHeader), reason: null };
}

module.exports = { createInvoice, verifyWebhookSignature };
