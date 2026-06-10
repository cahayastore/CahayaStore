'use strict';
/* ════════════════════════════════════════════════════════════════════
   Telegram Mini App initData validation (server-side, never trust client).
   Algorithm (per Telegram docs):
     dataCheckString = sorted "key=value" of all fields except `hash`, joined "\n"
     secretKey       = HMAC_SHA256("WebAppData", BOT_TOKEN)
     calcHash        = HMAC_SHA256(secretKey, dataCheckString)
     valid           = timingSafeEqual(calcHash, hash) && auth_date age <= 24h
   ════════════════════════════════════════════════════════════════════ */
const crypto = require('crypto');
const { query } = require('../db');
const { resolveToken } = require('./bot-loader');
const { ensureTelegramUser } = require('./handlers/_shared');

const MAX_AGE_SECONDS = 24 * 60 * 60;

/* Returns { ok, user, reason }. user = parsed Telegram user object. */
async function validateInitData(initData) {
  if (!initData || typeof initData !== 'string') return { ok: false, reason: 'missing' };
  const token = await resolveToken();
  if (!token) return { ok: false, reason: 'bot_not_configured' };

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'no_hash' };

  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || (Date.now() / 1000 - authDate) > MAX_AGE_SECONDS) {
    return { ok: false, reason: 'expired' };
  }

  const pairs = [];
  for (const [k, v] of params.entries()) {
    if (k === 'hash') continue;
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const calcHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const a = Buffer.from(calcHash, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_hash' };
  }

  let user = null;
  try { user = JSON.parse(params.get('user') || 'null'); } catch { user = null; }
  if (!user || !user.id) return { ok: false, reason: 'no_user' };

  return { ok: true, user };
}

/* Validate + ensure the marketplace user exists/linked. Returns { ok, dbUser, tgUser }. */
async function authenticateMiniApp(initData) {
  const res = await validateInitData(initData);
  if (!res.ok) return res;
  const dbUser = await ensureTelegramUser(res.user);
  return { ok: true, tgUser: res.user, dbUser };
}

module.exports = { validateInitData, authenticateMiniApp, MAX_AGE_SECONDS };
