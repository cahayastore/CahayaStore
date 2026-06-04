'use strict';
const { Bot, webhookCallback } = require('grammy');
const { getSetting, KEYS } = require('../settings.service');
const { query } = require('../db');

const bots = new Map(); // botId -> Bot instance

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

function clearCache() { bots.clear(); }

module.exports = { handleUpdate, clearCache };
