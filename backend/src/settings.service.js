'use strict';
const { query } = require('./db');
const { encryptJson, decryptJson } = require('./crypto');

// Known setting keys
const KEYS = {
  MYQRIS: 'payment.myqris',           // { merchant_id, api_key, webhook_secret, qris_static }
  TELEGRAM_BOT: 'telegram.bot',       // { token, username, webhook_secret }
  STORE_PROFILE: 'store.profile',     // { name, description, telegram_link, support_email }
  STORE_BANNERS: 'store.banners',     // { items: [{ id, image_url, link, alt, active, order }] }
  ORDER_POLICY: 'order.policy',       // { expiry_minutes }
  BOT_INFO_TEXT: 'bot.info_text'      // { text: string } - Info text shown when user clicks Info button
};

async function getSetting(key) {
  const r = await query(
    "SELECT value_encrypted, value_plain, is_secret FROM settings WHERE key = $1",
    [key]
  );
  if (!r.rows.length) return null;
  const row = r.rows[0];
  if (row.is_secret) {
    return row.value_encrypted ? decryptJson(row.value_encrypted) : null;
  }
  return row.value_plain || null;
}

async function setSetting(key, value, { secret = false } = {}) {
  const payload = secret
    ? { value_encrypted: encryptJson(value), value_plain: null, is_secret: true }
    : { value_encrypted: null, value_plain: value, is_secret: false };
  await query(
    `INSERT INTO settings (key, value_encrypted, value_plain, is_secret, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (key) DO UPDATE
       SET value_encrypted = EXCLUDED.value_encrypted,
           value_plain = EXCLUDED.value_plain,
           is_secret = EXCLUDED.is_secret,
           updated_at = now()`,
    [key, payload.value_encrypted, payload.value_plain, payload.is_secret]
  );
}

async function listSettings() {
  const r = await query(
    "SELECT key, is_secret, value_plain, updated_at FROM settings ORDER BY key"
  );
  return r.rows.map(row => ({
    key: row.key,
    is_secret: row.is_secret,
    has_value: row.is_secret ? true : !!row.value_plain,
    value: row.is_secret ? null : row.value_plain,
    updated_at: row.updated_at
  }));
}

module.exports = { KEYS, getSetting, setSetting, listSettings };
