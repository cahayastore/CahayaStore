'use strict';
const { InlineKeyboard } = require('grammy');
const { ensureTelegramUser, rupiah } = require('./_shared');
const { replyClean } = require('./_reply');
const wallet = require('../../wallet.service');

async function renderSaldo(ctx, { PRODUCT_DOMAIN, MINIAPP_VERSION } = {}) {
  let user = null;
  try { user = await ensureTelegramUser(ctx.from); } catch { /* ignore */ }
  if (!user) return ctx.reply('Tidak dapat memuat akun kamu.');

  const balance = await wallet.getBalance(user.id);
  const txs = await wallet.listTransactions(user.id, 5);
  const lines = txs.length
    ? txs.map((t) => {
        const sign = Number(t.amount) >= 0 ? '+' : '';
        return `• ${t.type}: ${sign}${rupiah(Math.abs(t.amount))}`;
      }).join('\n')
    : 'Belum ada transaksi.';

  const kb = new InlineKeyboard()
    .webApp('➕ Top Up Saldo', `${PRODUCT_DOMAIN}/?miniapp=1&topup=1&v=${MINIAPP_VERSION || '1'}`);
  await replyClean(ctx,
    `💰 <b>Saldo kamu: ${rupiah(balance)}</b>\n\n<b>Transaksi terakhir</b>\n${lines}`,
    { reply_markup: kb }
  );
}

function registerTopupHandlers(bot, opts = {}) {
  bot.command('saldo', (ctx) => renderSaldo(ctx, opts));
  bot.command('topup', (ctx) => renderSaldo(ctx, opts));
  bot.callbackQuery('menu:saldo', async (ctx) => { await ctx.answerCallbackQuery(); return renderSaldo(ctx, opts); });
}

module.exports = { registerTopupHandlers, renderSaldo };
