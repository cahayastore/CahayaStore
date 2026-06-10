'use strict';
/* ════════════════════════════════════════════════════════════════════
   BotService — single central marketplace bot (grammY).
   - Token: settings(telegram.bot).token  →  fallback process.env.TELEGRAM_BOT_TOKEN
   - Session: Redis (@grammyjs/storage-redis) when REDIS_URL set, else in-memory
   - Anti-spam debounce on callback_query
   - Modular handlers registered from ./handlers
   - Webhook mode in production; init()/registerWebhook() are idempotent.
   Never logs the token.
   ════════════════════════════════════════════════════════════════════ */
const crypto = require('crypto');
const { Bot, session } = require('grammy');
const { RedisAdapter } = require('@grammyjs/storage-redis');
const { getSetting, setSetting, KEYS } = require('../settings.service');
const { getRedis } = require('../redis');

const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || 'https://api.cahayastore.me').replace(/\/+$/, '');
const PRODUCT_DOMAIN = (process.env.PRODUCT_DOMAIN || 'https://cahayastore.me').replace(/\/+$/, '');
const DEFAULT_BOT_ID = process.env.TELEGRAM_BOT_ID || 'main';
const MINIAPP_VERSION = process.env.MINIAPP_VERSION || '1';

// Telegram secret_token charset: A-Z a-z 0-9 _ - (1-256).
const SECRET_RE = /^[A-Za-z0-9_-]{1,256}$/;

let botInstance = null;
let initPromise = null;       // race-safe single init
let cachedToken = null;       // detect token changes → rebuild
let activeWebhookSecret = null; // last secret used to register the webhook

// Anti-spam: last handled time per `${userId}:${data}`.
const debounceMap = new Map();
const DEBOUNCE_MS = 1500;

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/* Resolve the bot token: admin settings first, then ENV. */
async function resolveToken() {
  let cfg = null;
  try { cfg = await getSetting(KEYS.TELEGRAM_BOT); } catch { /* ignore */ }
  if (cfg && cfg.token) return cfg.token;
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  return null;
}

function buildSessionMiddleware() {
  const redis = getRedis();
  const initial = () => ({ step: 'idle', tempData: {} });
  if (redis) {
    return session({
      initial,
      storage: new RedisAdapter({ instance: redis, ttl: 14 * 24 * 60 * 60 }),
      getSessionKey: (ctx) => (ctx.from ? `telegram-bot:session:${ctx.from.id}` : undefined),
    });
  }
  return session({ initial, getSessionKey: (ctx) => (ctx.from ? String(ctx.from.id) : undefined) });
}

/* Build + wire a fresh Bot instance with middleware and handlers. */
function buildBot(token) {
  const bot = new Bot(token);

  bot.catch((err) => {
    console.error('[tg bot]', err.error?.message || err.message || err);
    const ctx = err.ctx;
    if (ctx && ctx.callbackQuery) ctx.answerCallbackQuery().catch(() => {});
  });

  // Anti-spam debounce for callback queries.
  bot.on('callback_query:data', async (ctx, next) => {
    const key = `${ctx.from?.id}:${ctx.callbackQuery.data}`;
    const now = Date.now();
    const last = debounceMap.get(key) || 0;
    if (now - last < DEBOUNCE_MS) { await ctx.answerCallbackQuery().catch(() => {}); return; }
    debounceMap.set(key, now);
    return next();
  });

  bot.use(buildSessionMiddleware());

  // Register modular handlers.
  try {
    const { registerHandlers } = require('./handlers');
    registerHandlers(bot, { PRODUCT_DOMAIN, MINIAPP_VERSION });
  } catch (e) {
    console.error('[tg handlers]', e.message);
  }

  return bot;
}

/* Idempotent, race-safe init. Rebuilds if the token changed. */
async function ensureBot() {
  const token = await resolveToken();
  if (!token) throw new Error('Telegram bot token not configured');

  if (botInstance && cachedToken === token) return botInstance;
  if (initPromise && cachedToken === token) return initPromise;

  cachedToken = token;
  initPromise = (async () => {
    const bot = buildBot(token);
    await bot.init();
    botInstance = bot;
    return bot;
  })();
  try {
    return await initPromise;
  } finally {
    initPromise = null;
  }
}

async function handleUpdate(_botIdOrUpdate, maybeUpdate) {
  // Backwards-compatible: handleUpdate(update) or handleUpdate(botId, update).
  const update = maybeUpdate !== undefined ? maybeUpdate : _botIdOrUpdate;
  const bot = await ensureBot();
  await bot.handleUpdate(update);
}

/* Register (or refresh) the webhook at /webhooks/telegram. */
async function registerWebhook() {
  const token = await resolveToken();
  if (!token) throw new Error('Telegram bot token not configured');

  let cfg = null;
  try { cfg = await getSetting(KEYS.TELEGRAM_BOT); } catch { cfg = null; }
  let secret = (cfg && cfg.webhook_secret) || process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || !SECRET_RE.test(secret)) {
    secret = crypto.randomBytes(16).toString('hex');
    try {
      await setSetting(
        KEYS.TELEGRAM_BOT,
        { ...(cfg || {}), webhook_secret: secret },
        { secret: true }
      );
    } catch (e) { console.warn('[tg] could not persist webhook secret:', e.message); }
  }

  const url = `${PUBLIC_API_URL}/webhooks/telegram`;
  const bot = await ensureBot();

  await bot.api.setWebhook(url, {
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
  activeWebhookSecret = secret;

  // Chat menu button → opens the Mini App.
  try {
    await bot.api.setChatMenuButton({
      menu_button: {
        type: 'web_app',
        text: 'Buka Toko',
        web_app: { url: `${PRODUCT_DOMAIN}/?miniapp=1&v=${MINIAPP_VERSION}` },
      },
    });
  } catch (e) { console.warn('[tg setChatMenuButton]', e.message); }

  // Command menu.
  try {
    await bot.api.setMyCommands([
      { command: 'start', description: 'Mulai & buka toko' },
      { command: 'products', description: 'Lihat katalog terbaru' },
      { command: 'orders', description: 'Riwayat pesanan saya' },
      { command: 'saldo', description: 'Cek saldo & top up' },
      { command: 'referral', description: 'Program referral' },
      { command: 'bantuan', description: 'Bantuan' },
    ]);
  } catch (e) { console.warn('[tg setMyCommands]', e.message); }

  return { ok: true, url, webhookSecret: secret };
}

async function deleteWebhook() {
  const token = await resolveToken();
  if (!token) return { ok: false, reason: 'not_configured' };
  const bot = await ensureBot();
  await bot.api.deleteWebhook({ drop_pending_updates: false });
  return { ok: true };
}

function clearCache() {
  botInstance = null;
  cachedToken = null;
  initPromise = null;
}

/* Send a plain HTML message to a chat. Best-effort. */
async function sendMessage(chatId, text, opts = {}) {
  if (!chatId) return { ok: false, reason: 'no_chat_id' };
  const bot = await ensureBot();
  await bot.api.sendMessage(String(chatId), text, { parse_mode: 'HTML', ...opts });
  return { ok: true };
}

/* Notify the admin chat that an order has been paid. Never throws. */
async function notifyOrderPaid(order) {
  try {
    const cfg = await getSetting(KEYS.TELEGRAM_BOT);
    if (!cfg || !cfg.admin_chat_id) return { ok: false, reason: 'not_configured' };
    const amount = Number(order.amount || order.total_amount || 0).toLocaleString('id-ID');
    const lines = [
      '🟢 <b>Pembayaran diterima</b>',
      `Order: <code>${escapeHtml(order.orderNo || order.order_no || '-')}</code>`,
      `Jumlah: <b>Rp${amount}</b>`,
    ];
    if (order.email || order.buyer_email) lines.push(`Email: ${escapeHtml(order.email || order.buyer_email)}`);
    if (order.products) lines.push(`Produk: ${escapeHtml(order.products)}`);
    if (order.channel) lines.push(`Channel: ${escapeHtml(order.channel)}`);
    await sendMessage(cfg.admin_chat_id, lines.join('\n'));
    return { ok: true };
  } catch (e) {
    console.error('[tg notifyOrderPaid]', e.message);
    return { ok: false, error: e.message };
  }
}

/* Notify a specific buyer (by telegram_id). Best-effort. */
async function notifyBuyer(telegramId, text, opts = {}) {
  if (!telegramId) return { ok: false, reason: 'no_telegram_id' };
  try { return await sendMessage(telegramId, text, opts); }
  catch (e) { console.error('[tg notifyBuyer]', e.message); return { ok: false, error: e.message }; }
}

/* Verify the inbound webhook secret against ENV or the active/settings secret. */
async function verifyWebhookSecret(provided) {
  const candidates = [];
  if (process.env.TELEGRAM_WEBHOOK_SECRET) candidates.push(process.env.TELEGRAM_WEBHOOK_SECRET);
  if (activeWebhookSecret) candidates.push(activeWebhookSecret);
  try {
    const cfg = await getSetting(KEYS.TELEGRAM_BOT);
    if (cfg && cfg.webhook_secret) candidates.push(cfg.webhook_secret);
  } catch { /* ignore */ }
  if (!candidates.length) return false; // no secret configured → reject
  return candidates.includes(String(provided || ''));
}

module.exports = {
  ensureBot, handleUpdate, registerWebhook, deleteWebhook, clearCache,
  sendMessage, notifyOrderPaid, notifyBuyer, resolveToken, verifyWebhookSecret,
  DEFAULT_BOT_ID, escapeHtml,
};
