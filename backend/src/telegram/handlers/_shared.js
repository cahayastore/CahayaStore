'use strict';
/* Shared helpers for Telegram bot handlers. */
const crypto = require('crypto');
const { query } = require('../../db');

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function rupiah(v) {
  const n = Number(v || 0);
  return n <= 0 ? 'Gratis' : 'Rp' + n.toLocaleString('id-ID');
}

function genReferralCode() {
  return 'CS' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

/* Find or create a marketplace user linked to a Telegram account.
   Links by telegram_id; backfills username + referral_code. Returns user row. */
async function ensureTelegramUser(tgUser) {
  if (!tgUser || !tgUser.id) return null;
  const tgId = String(tgUser.id);
  const username = tgUser.username || null;
  const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || username || `tg_${tgId}`;

  const existing = await query(
    'SELECT id, role, name, email, telegram_id, referral_code FROM users WHERE telegram_id = $1',
    [tgId]
  );
  if (existing.rows.length) {
    const u = existing.rows[0];
    if (username && username !== u.telegram_username) {
      await query('UPDATE users SET telegram_username = $2, updated_at = now() WHERE id = $1', [u.id, username]);
    }
    if (!u.referral_code) {
      await query('UPDATE users SET referral_code = $2 WHERE id = $1', [u.id, genReferralCode()]);
    }
    return u;
  }

  // New Telegram-only buyer (no email yet).
  const ins = await query(
    `INSERT INTO users (role, name, telegram_id, telegram_username, referral_code, is_active)
     VALUES ('buyer', $1, $2, $3, $4, TRUE)
     RETURNING id, role, name, email, telegram_id, referral_code`,
    [name, tgId, username, genReferralCode()]
  );
  return ins.rows[0];
}

module.exports = { escapeHtml, rupiah, genReferralCode, ensureTelegramUser };
