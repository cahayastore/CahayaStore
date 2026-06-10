'use strict';
const { query } = require('../../db');
const { escapeHtml } = require('./_shared');

async function renderPromo(ctx) {
  // Promo banner/text from bot_config if present.
  let banner = null;
  try {
    const r = await query('SELECT banner_url, menu_config FROM bot_config WHERE id = 1');
    banner = r.rows[0]?.banner_url || null;
  } catch { /* ignore */ }
  const text = '🔥 <b>Promo Cahaya Store</b>\nPantau terus katalog untuk penawaran terbaru. Gunakan /products.';
  if (banner) {
    try { return await ctx.replyWithPhoto(banner, { caption: text, parse_mode: 'HTML' }); }
    catch { /* fall through to text */ }
  }
  await ctx.reply(text, { parse_mode: 'HTML' });
}

function registerPromoHandlers(bot) {
  bot.command('promo', (ctx) => renderPromo(ctx));
  bot.callbackQuery('menu:promo', async (ctx) => { await ctx.answerCallbackQuery(); return renderPromo(ctx); });
}

module.exports = { registerPromoHandlers, renderPromo };
