'use strict';
const { query } = require('../../db');
const { ensureTelegramUser } = require('./_shared');
const { showProductList, menuReplyKeyboard } = require('./v3-menu');

function registerStartHandlers(bot) {
  bot.command('start', async (ctx) => {
    // Link / register the Telegram user.
    let user = null;
    try { user = await ensureTelegramUser(ctx.from); } catch (e) { console.error('[tg start link]', e.message); }

    // Referral deep-link: /start ref_<CODE>
    const payload = (ctx.match || '').trim();
    if (user && payload && /^ref[_-]/i.test(payload)) {
      const code = payload.replace(/^ref[_-]/i, '').toUpperCase();
      try {
        const ref = await query('SELECT id FROM users WHERE referral_code = $1', [code]);
        if (ref.rows.length && ref.rows[0].id !== user.id) {
          await query(
            'UPDATE users SET referred_by = $2 WHERE id = $1 AND referred_by IS NULL',
            [user.id, ref.rows[0].id]
          );
        }
      } catch (e) { console.error('[tg start ref]', e.message); }
    }

    // Single-screen UX (like Marketku): set the persistent "Menu" keyboard once,
    // then show the numbered product list as the main screen. No extra menu spam.
    try {
      await ctx.reply('🛍️ <b>Cahaya Store</b>', { parse_mode: 'HTML', reply_markup: menuReplyKeyboard() });
    } catch (e) { console.error('[tg start kb]', e.message); }
    try {
      await showProductList(ctx, 0);
    } catch (e) { console.error('[tg start v3]', e.message); }
  });

  // Admin helper to discover chat id.
  bot.command('chatid', async (ctx) => {
    await ctx.reply(`Chat ID kamu: <code>${ctx.chat.id}</code>`, { parse_mode: 'HTML' });
  });
}

module.exports = { registerStartHandlers };
