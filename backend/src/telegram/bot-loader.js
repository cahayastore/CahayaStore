'use strict';
const { Bot } = require('grammy');
const { getSetting, KEYS } = require('../settings.service');
const { query } = require('../db');

const bots = new Map(); // botId -> Bot instance

// Public base URL of the API (where Telegram should POST updates).
const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || 'https://api.cahayastore.me').replace(/\/+$/, '');
const DEFAULT_BOT_ID = process.env.TELEGRAM_BOT_ID || 'main';

function buildBot(token) {
  const bot = new Bot(token);
  bot.command('start', async (ctx) => {
    await ctx.reply(
      'Selamat datang di Cahaya Store!\n' +
      'Gunakan /products untuk lihat katalog terbaru.'
    );
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
  if (!cfg.webhook_secret) throw new Error('Telegram webhook_secret not configured');

  const url = `${PUBLIC_API_URL}/api/webhooks/telegram/${botId}`;
  const bot = await getOrLoadBot(botId);

  await bot.api.setWebhook(url, {
    secret_token: cfg.webhook_secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
  });

  // Publish the command menu (best-effort).
  try {
    await bot.api.setMyCommands([
      { command: 'start', description: 'Mulai & info toko' },
      { command: 'products', description: 'Lihat katalog terbaru' },
    ]);
  } catch (e) { console.warn('[tg setMyCommands]', e.message); }

  return { ok: true, url };
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

module.exports = { handleUpdate, registerWebhook, deleteWebhook, clearCache, DEFAULT_BOT_ID };

