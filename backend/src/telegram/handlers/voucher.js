'use strict';
/* Voucher redemption in the bot. User taps 🎟️ Voucher → types a code →
   balance credited via voucher.service (atomic, limit-checked). On success the
   configured admin chat is notified. */
const { InlineKeyboard } = require('grammy');
const { ensureTelegramUser, rupiah } = require('./_shared');
const { replyClean } = require('./_reply');
const voucher = require('../../voucher.service');

async function promptVoucher(ctx) {
  if (!ctx.session) ctx.session = {};
  ctx.session.awaitingVoucherCode = true;
  return replyClean(ctx,
    '🎟️ <b>Tukar Voucher</b>\n\n' +
    'Ketik kode voucher kamu untuk menambah saldo.\n' +
    'Contoh: <code>HEMAT50</code>'
  );
}

/* Best-effort: tell the configured admin chat that a voucher was redeemed. */
async function notifyAdminRedeem(ctx, user, res) {
  try {
    const { getSetting, KEYS } = require('../../settings.service');
    const cfg = await getSetting(KEYS.TELEGRAM_BOT);
    if (!cfg || !cfg.admin_chat_id) return;
    const loader = require('../bot-loader');
    const who = user.telegram_username
      ? `@${user.telegram_username}`
      : (user.name || `ID ${user.telegram_id || user.id}`);
    await loader.sendMessage(cfg.admin_chat_id,
      '🎟️ <b>Voucher ditukar</b>\n' +
      `Kode: <code>${voucher.normalizeCode(res.code)}</code>\n` +
      `Oleh: ${who}\n` +
      `Nominal: <b>${rupiah(res.amount)}</b>`);
  } catch (e) {
    console.error('[voucher notify admin]', e.message);
  }
}

async function redeemCode(ctx, code) {
  let user = null;
  try { user = await ensureTelegramUser(ctx.from); } catch { /* ignore */ }
  if (!user) return replyClean(ctx, 'Tidak dapat memuat akun kamu. Coba /start dulu.');

  try {
    const res = await voucher.redeemVoucher({ code, userId: user.id });
    const kb = new InlineKeyboard().text('💰 Saldo Saya', 'menu:saldo').text('📦 Belanja', 'menu:products');
    await replyClean(ctx,
      `✅ <b>Voucher berhasil ditukar!</b>\n` +
      `Kode: <code>${voucher.normalizeCode(res.code)}</code>\n` +
      `Saldo bertambah: <b>${rupiah(res.amount)}</b>\n` +
      `Saldo sekarang: <b>${rupiah(res.balance)}</b>`,
      { reply_markup: kb });
    // Fire-and-forget admin notification.
    notifyAdminRedeem(ctx, user, res);
    return;
  } catch (e) {
    return replyClean(ctx, `⚠️ ${e.message || 'Voucher tidak bisa ditukar.'}`);
  }
}

function registerVoucherHandlers(bot) {
  bot.hears('🎟️ Voucher', promptVoucher);
  bot.command('voucher', promptVoucher);
  bot.callbackQuery('menu:voucher', async (ctx) => { await ctx.answerCallbackQuery(); return promptVoucher(ctx); });

  // Capture a typed voucher code only when awaiting it. Codes are alphanumeric
  // (+ - _), 3-32 chars; pass through otherwise.
  bot.hears(/^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/, async (ctx, next) => {
    if (!ctx.session || !ctx.session.awaitingVoucherCode) return typeof next === 'function' ? next() : undefined;
    ctx.session.awaitingVoucherCode = false;
    return redeemCode(ctx, ctx.message.text);
  });
}

module.exports = { registerVoucherHandlers, promptVoucher };
