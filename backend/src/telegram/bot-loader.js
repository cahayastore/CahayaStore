'use strict';
const crypto = require('crypto');
const { Bot } = require('grammy');
const { getSetting, setSetting, KEYS } = require('../settings.service');
const { query } = require('../db');

const bots = new Map(); // botId -> Bot instance

// Public base URL of the API (where Telegram should POST updates).
const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || 'https://api.cahayastore.me').replace(/\/+$/, '');
const DEFAULT_BOT_ID = process.env.TELEGRAM_BOT_ID || 'main';

// Telegram only allows A-Z, a-z, 0-9, _ and - (1-256 chars) for secret_token.
const SECRET_RE = /^[A-Za-z0-9_-]{1,256}$/;

function buildBot(token) {
  const bot = new Bot(token);
  bot.command('start', async (ctx) => {
    await ctx.reply(
      'Selamat datang di Cahaya Store!\n' +
      'Gunakan /products untuk lihat katalog terbaru.'
    );
  });
  // Helper for admins to discover the chat ID to use for notifications.
  bot.command('chatid', async (ctx) => {
    await ctx.reply(`Chat ID kamu: <code>${ctx.chat.id}</code>\nSalin ini ke kolom "Admin Chat ID" di Pengaturan.`,
      { parse_mode: 'HTML' });
  });
  bot.command('products', async (ctx) => {
    try {
      const r = await query(
        "SELECT name, price, product_type FROM products WHERE is_active = TRUE ORDER BY created_at DESC LIMIT 10"
      );
      if (!r.rows.length) return ctx.reply('Belum ada produk.');
      const lines = r.rows.map(p => `• ${p.name} — Rp${Number(p.price).toLocaleString('id-ID')} (${p.product_type})`);
      await ctx.reply('Produk terbaru:\n' + lines.join('\n'));
    } catch (e) {
      console.error('[tg /products]', e);
      await ctx.reply('Maaf, terjadi kesalahan.');
    }
  });
  bot.catch((err) => console.error('[tg bot]', err));
  return bot;
}

async function getOrLoadBot(botId) {
  if (bots.has(botId)) return bots.get(botId);
  const cfg = await getSetting(KEYS.TELEGRAM_BOT);
  if (!cfg || !cfg.token) throw new Error('Telegram bot token not configured');
  const bot = buildBot(cfg.token);
  await bot.init();
  bots.set(botId, bot);
  return bot;
}

async function handleUpdate(botId, update) {
  const bot = await getOrLoadBot(botId);
  await bot.handleUpdate(update);
}

/* Register (or refresh) the Telegram webhook so updates flow to this server.
   Returns { ok, url } or throws. Safe to call repeatedly (idempotent). */
async function registerWebhook(botId = DEFAULT_BOT_ID) {
  const cfg = await getSetting(KEYS.TELEGRAM_BOT);
  if (!cfg || !cfg.token) throw new Error('Telegram bot token not configured');

  // Telegram restricts the secret_token charset. If the stored secret is empty
  // or contains unallowed characters, generate a compatible one and persist it
  // (so the inbound x-telegram-bot-api-secret-token check keeps matching).
  let secret = cfg.webhook_secret;
  if (!secret || !SECRET_RE.test(secret)) {
    secret = crypto.randomBytes(24).toString('base64url'); // url-safe: A-Za-z0-9_-
    await setSetting(KEYS.TELEGRAM_BOT, { ...cfg, webhook_secret: secret }, { secret: true });
    clearCache();
  }

  const url = `${PUBLIC_API_URL}/api/webhooks/telegram/${botId}`;
  const bot = await getOrLoadBot(botId);

  await bot.api.setWebhook(url, {
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
  });

  // Publish the command menu (best-effort).
  try {
    await bot.api.setMyCommands([
      { command: 'start', description: 'Mulai & info toko' },
      { command: 'products', description: 'Lihat katalog terbaru' },
      { command: 'chatid', description: 'Tampilkan Chat ID (untuk admin)' },
    ]);
  } catch (e) { console.warn('[tg setMyCommands]', e.message); }

  return { ok: true, url, secretRegenerated: secret !== cfg.webhook_secret };
}

/* Remove the webhook (e.g. when disabling the bot). */
async function deleteWebhook(botId = DEFAULT_BOT_ID) {
  const cfg = await getSetting(KEYS.TELEGRAM_BOT);
  if (!cfg || !cfg.token) return { ok: false, reason: 'not_configured' };
  const bot = await getOrLoadBot(botId);
  await bot.api.deleteWebhook({ drop_pending_updates: false });
  return { ok: true };
}

function clearCache() { bots.clear(); }

/* Send a plain message to a chat via the configured bot. Best-effort. */
async function sendMessage(chatId, text, opts = {}, botId = DEFAULT_BOT_ID) {
  if (!chatId) return { ok: false, reason: 'no_chat_id' };
  const bot = await getOrLoadBot(botId);
  await bot.api.sendMessage(String(chatId), text, { parse_mode: 'HTML', ...opts });
  return { ok: true };
}

/* Notify the admin chat that an order has been paid. Never throws. */
async function notifyOrderPaid(order) {
  try {
    const cfg = await getSetting(KEYS.TELEGRAM_BOT);
    if (!cfg || !cfg.token || !cfg.admin_chat_id) return { ok: false, reason: 'not_configured' };
    const amount = Number(order.amount || order.total_amount || 0).toLocaleString('id-ID');
    const lines = [
      '🟢 <b>Pembayaran diterima</b>',
      `Order: <code>${escapeHtml(order.orderNo || order.order_no || '-')}</code>`,
      `Jumlah: <b>Rp${amount}</b>`,
    ];
    if (order.email || order.buyer_email) lines.push(`Email: ${escapeHtml(order.email || order.buyer_email)}`);
    if (order.products) lines.push(`Produk: ${escapeHtml(order.products)}`);
    await sendMessage(cfg.admin_chat_id, lines.join('\n'));
    return { ok: true };
  } catch (e) {
    console.error('[tg notifyOrderPaid]', e.message);
    return { ok: false, error: e.message };
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

module.exports = {
  handleUpdate, registerWebhook, deleteWebhook, clearCache,
  sendMessage, notifyOrderPaid, DEFAULT_BOT_ID,
};

