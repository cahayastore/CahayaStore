'use strict';
const { getSetting, KEYS } = require('../settings.service');
const { safeEqual } = require('../crypto');

/**
 * MyQRIS service — PayHook-style flow.
 *
 * Config (settings key payment.myqris):
 *   {
 *     qris_static:   "<EMV QRIS string from merchant>",
 *     webhook_token: "<shared secret for PayHook callback>",
 *     unique_max:    50,         // max unique rupiah added to disambiguate orders
 *     merchant_name: "Cahaya Store"
 *   }
 *
 * Flow:
 *   1. createInvoice(amount) → dynamic QRIS embedding the (unique) amount.
 *   2. Buyer pays the EXACT amount; PayHook app on the merchant phone receives
 *      the bank/e-wallet notification and POSTs { amount, token } to our webhook.
 *   3. Webhook matches a pending payment by amount → mark paid → deliver.
 */

async function loadConfig() {
  const cfg = await getSetting(KEYS.MYQRIS);
  if (!cfg || !cfg.qris_static) {
    const err = new Error('MyQRIS belum dikonfigurasi. Atur di panel admin -> Pembayaran.');
    err.code = 'MYQRIS_NOT_CONFIGURED';
    throw err;
  }
  return cfg;
}

/* CRC16-CCITT (0x1021), QRIS standard. */
function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i += 1) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Convert a static QRIS into a dynamic one carrying `amount`.
 *  - Tag 01 (point of initiation): "11" (static) -> "12" (dynamic)
 *  - Insert tag 54 (transaction amount) before tag 58 (country code)
 *  - Recompute tag 63 (CRC)
 */
function buildDynamicQris(staticQris, amount) {
  let q = String(staticQris).trim();
  const idx63 = q.lastIndexOf('6304');
  if (idx63 !== -1 && idx63 >= q.length - 8) q = q.slice(0, idx63);

  q = q.replace('010211', '010212');

  const amt = String(Math.round(Number(amount)));
  const tag54 = '54' + String(amt.length).padStart(2, '0') + amt;

  const idx58 = q.indexOf('5802');
  if (idx58 !== -1) q = q.slice(0, idx58) + tag54 + q.slice(idx58);
  else q += tag54;

  const withTag = q + '6304';
  return withTag + crc16(withTag);
}

/**
 * Create invoice: returns dynamic QRIS payload. Caller persists the unique
 * `amount` on the payment row so the webhook can match by amount.
 */
async function createInvoice({ orderNo, amount }) {
  const cfg = await loadConfig();
  const qris = buildDynamicQris(cfg.qris_static, amount);
  return {
    provider: 'myqris',
    payment_ref: `${cfg.merchant_name || 'CAHAYA'}-${orderNo}`,
    qr_payload: qris,
    amount,
    raw: null,
  };
}

/* Max unique rupiah offset configured by admin (default 50, capped 1..200). */
async function getUniqueMax() {
  const cfg = await getSetting(KEYS.MYQRIS).catch(() => null);
  return Math.max(1, Math.min(200, Number(cfg && cfg.unique_max) || 50));
}

/* Verify PayHook webhook auth (shared token in header or body). */
async function verifyPayhookToken(provided) {
  const cfg = await loadConfig();
  if (!cfg.webhook_token) return { ok: false, reason: 'no_token' };
  if (!provided) return { ok: false, reason: 'no_token_provided' };
  return { ok: safeEqual(String(provided), String(cfg.webhook_token)), reason: null };
}

module.exports = {
  createInvoice,
  buildDynamicQris,
  crc16,
  getUniqueMax,
  verifyPayhookToken,
};
