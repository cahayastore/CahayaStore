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

/* Brand/impersonation words blocked as whole tokens in the merchant name. */
const SENSITIVE_WORDS = ['BANK', 'MANDIRI', 'BCA', 'BRI', 'BNI', 'DANA', 'OVO', 'GOPAY', 'SHOPEE', 'ADMIN', 'OFFICIAL', 'QRIS', 'BI'];

/* Sanitize free text for QRIS embedding: uppercase, keep only A-Z 0-9 + space,
   strip emoji/symbols/diacritics, collapse spaces. (mirrors marketku.id) */
function sanitizeMerchantText(raw) {
  if (raw == null) return '';
  let s = String(raw).normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  s = s.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  return s;
}

/* Build the merchant name (EMV tag 59) from a raw store name. Falls back to
   'TOKO' when empty or when any whole-word token is sensitive; caps to 25. */
function buildMerchantName(storeName) {
  const sanitized = sanitizeMerchantText(storeName);
  if (!sanitized) return 'TOKO';
  if (sanitized.split(' ').some((tok) => SENSITIVE_WORDS.includes(tok))) return 'TOKO';
  return sanitized.length > 25 ? sanitized.slice(0, 25).replace(/\s+$/, '') : sanitized;
}

/* Build the merchant city (EMV tag 60). Sanitize + cap 15. null when empty. */
function buildCityName(city) {
  const sanitized = sanitizeMerchantText(city);
  if (!sanitized) return null;
  return sanitized.length > 15 ? sanitized.slice(0, 15).replace(/\s+$/, '') : sanitized;
}

/* Replace (or insert before tag 58) a 2-digit EMV TLV tag's value in a payload
   that has NO trailing CRC. Length is re-encoded. Tag 59 = merchant name. */
function setTlvTag(payload, tag, value) {
  const val = String(value);
  const newField = tag + String(val.length).padStart(2, '0') + val;
  // Find an existing occurrence of `tag` at a TLV boundary by walking the TLVs.
  let i = 0;
  while (i + 4 <= payload.length) {
    const t = payload.slice(i, i + 2);
    const len = parseInt(payload.slice(i + 2, i + 4), 10);
    if (!Number.isFinite(len)) break;
    const fieldEnd = i + 4 + len;
    if (t === tag) {
      return payload.slice(0, i) + newField + payload.slice(fieldEnd);
    }
    i = fieldEnd;
  }
  // Not present → insert before tag 58 (country code), else append.
  const idx58 = payload.indexOf('5802');
  if (idx58 !== -1) return payload.slice(0, idx58) + newField + payload.slice(idx58);
  return payload + newField;
}

/**
 * Convert a static QRIS into a dynamic one carrying `amount`.
 *  - Tag 01 (point of initiation): "11" (static) -> "12" (dynamic)
 *  - Insert tag 54 (transaction amount) before tag 58 (country code)
 *  - (Optional) Override tag 59 (merchant name) / tag 60 (city) so the name
 *    shown when scanning is the sanitized store name.
 *  - Recompute tag 63 (CRC)
 */
function buildDynamicQris(staticQris, amount, opts = {}) {
  let q = String(staticQris).trim();
  const idx63 = q.lastIndexOf('6304');
  if (idx63 !== -1 && idx63 >= q.length - 8) q = q.slice(0, idx63);

  q = q.replace('010211', '010212');

  const amt = String(Math.round(Number(amount)));
  const tag54 = '54' + String(amt.length).padStart(2, '0') + amt;

  const idx58 = q.indexOf('5802');
  if (idx58 !== -1) q = q.slice(0, idx58) + tag54 + q.slice(idx58);
  else q += tag54;

  // Optional merchant-name / city override (sanitized).
  if (opts && typeof opts.merchantName === 'string' && opts.merchantName.length > 0) {
    q = setTlvTag(q, '59', opts.merchantName);
  }
  if (opts && typeof opts.city === 'string' && opts.city.length > 0) {
    q = setTlvTag(q, '60', opts.city);
  }

  const withTag = q + '6304';
  return withTag + crc16(withTag);
}

/**
 * Create invoice: returns dynamic QRIS payload. Caller persists the unique
 * `amount` on the payment row so the webhook can match by amount.
 */
async function createInvoice({ orderNo, amount }) {
  const cfg = await loadConfig();
  // Sanitized merchant name shown on scan: prefer explicit qris_merchant_name,
  // else merchant_name, else the store profile name.
  let storeName = cfg.qris_merchant_name || cfg.merchant_name || '';
  if (!storeName) {
    try {
      const profile = await getSetting(KEYS.STORE_PROFILE);
      if (profile && profile.name) storeName = profile.name;
    } catch (e) { /* ignore */ }
  }
  const merchantName = buildMerchantName(storeName || 'Cahaya Store');
  const city = buildCityName(cfg.qris_city || '');
  const qris = buildDynamicQris(cfg.qris_static, amount, { merchantName, city: city || undefined });
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
