'use strict';
const { query } = require('../../db');
const { ensureTelegramUser } = require('./_shared');
const { showProductList, menuReplyKeyboard } = require('./v3-menu');
const { issueWebSession } = require('../../customer-auth');
const { getSetting, KEYS } = require('../../settings.service');

const START_PRODUCT_DOMAIN = (process.env.PRODUCT_DOMAIN || 'https://cahayastore.me').replace(/\/+$/, '');
const START_MINIAPP_VERSION = process.env.MINIAPP_VERSION || '1';

function registerStartHandlers(bot) {
  bot.command('start', async (ctx) => {
    // Link / register the Telegram user.
    let user = null;
    try { user = await ensureTelegramUser(ctx.from); } catch (e) { console.error('[tg start link]', e.message); }

    // Identity-on-/start: build a per-user web-session token and attach it to the
    // chat's "Buka Toko" menu button URL. This bypasses unreliable Telegram initData
    // so the order + credential delivery always belong to the user who pressed /start.
    if (user && user.id) {
      try {
        const ws = issueWebSession(user);
        await ctx.api.setChatMenuButton({
          chat_id: ctx.chat.id,
          menu_button: {
            type: 'web_app',
            text: 'Buka Toko',
            web_app: { url: `${START_PRODUCT_DOMAIN}/miniapp.html?v=${START_MINIAPP_VERSION}&cs_ws=${encodeURIComponent(ws)}` },
          },
        });
      } catch (e) { console.error('[tg start menu-button]', e.message); }
    }

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

    // Single-screen UX: if a banner is configured, show it (with the colored menu
    // keyboard). Otherwise skip straight to the product list (which already carries
    // the keyboard) — no redundant greeting message.
    let banner = null;
    try { banner = await getSetting(KEYS.BOT_BANNER); } catch (e) {}
    if (banner && banner.image_url) {
      try {
        await ctx.replyWithPhoto(banner.image_url, {
          caption: (banner.caption || '').trim() || undefined,
          parse_mode: 'HTML',
          reply_markup: menuReplyKeyboard(),
        });
      } catch (e) { console.error('[tg start banner]', e.message); }
    }
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
