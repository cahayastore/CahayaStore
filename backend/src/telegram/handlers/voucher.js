'use strict';
/* Voucher redemption in the bot. User taps 🎟️ Voucher → types a code →
   balance credited via voucher.service (atomic, limit-checked). */
const { InlineKeyboard } = require('grammy');
const { ensureTelegramUser, rupiah } = require('./_shared');
const { replyClean, editOrReply } = require('./_reply');
const voucher = require('../../voucher.service');
const wallet = require('../../wallet.service');

async function promptVoucher(ctx) {
  if (!ctx.session) ctx.session = {};
  ctx.session.awaitingVoucherCode = true;
  return replyClean(ctx,
    '🎟️ <b>Tukar Voucher</b>\n\n' +
    'Ketik kode voucher kamu untuk menambah saldo.\n' +
    'Contoh: <code>HEMAT50</code>'
  );
}

async function redeemCode(ctx, code) {
  let user = null;
  try { user = await ensureTelegramUser(ctx.from); } catch { /* ignore */ }
  if (!user) return replyClean(ctx, 'Tidak dapat memuat akun kamu. Coba /start dulu.');

  try {
    const res = await voucher.redeemVoucher({ code, userId: user.id });
    const kb = new InlineKeyboard().text('💰 Saldo Saya', 'menu:saldo').text('📦 Belanja', 'menu:products');
    return replyClean(ctx,
      `✅ <b>Voucher berhasil ditukar!</b>\n` +
      `Kode: <code>${voucher.normalizeCode(res.code)}</code>\n` +
      `Saldo bertambah: <b>${rupiah(res.amount)}</b>\n` +
      `Saldo sekarang: <b>${rupiah(res.balance)}</b>`,
      { reply_markup: kb });
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
