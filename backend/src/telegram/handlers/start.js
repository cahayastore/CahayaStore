'use strict';
const { InlineKeyboard } = require('grammy');
const { query } = require('../../db');
const { ensureTelegramUser, escapeHtml } = require('./_shared');

function registerStartHandlers(bot, { PRODUCT_DOMAIN, MINIAPP_VERSION } = {}) {
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

    let welcome = 'Selamat datang di <b>Cahaya Store</b>! 🛍️\nMarketplace produk digital — pembayaran QRIS, kirim instan.';
    try {
      const cfg = await query('SELECT welcome_message FROM bot_config WHERE id = 1');
      if (cfg.rows[0]?.welcome_message) welcome = cfg.rows[0].welcome_message;
    } catch { /* table may not exist yet */ }

    const kb = new InlineKeyboard()
      .webApp('🛒 Buka Toko', `${PRODUCT_DOMAIN}/?miniapp=1&v=${MINIAPP_VERSION || '1'}`).row()
      .text('📦 Produk', 'menu:products').text('🗂️ Kategori', 'menu:categories').row()
      .text('🧾 Pesanan', 'menu:orders').text('💰 Saldo', 'menu:saldo').row()
      .text('🎁 Referral', 'menu:referral').text('❓ Bantuan', 'menu:help');

    await ctx.reply(welcome, { parse_mode: 'HTML', reply_markup: kb });
  });

  // Admin helper to discover chat id.
  bot.command('chatid', async (ctx) => {
    await ctx.reply(`Chat ID kamu: <code>${ctx.chat.id}</code>`, { parse_mode: 'HTML' });
  });
}

module.exports = { registerStartHandlers };
