'use strict';
const { query } = require('../../db');
const { ensureTelegramUser, escapeHtml, rupiah } = require('./_shared');
const { replyClean } = require('./_reply');
const wallet = require('../../wallet.service');

async function renderProfile(ctx) {
  let user = null;
  try { user = await ensureTelegramUser(ctx.from); } catch { /* ignore */ }
  if (!user) return ctx.reply('Tidak dapat memuat akun kamu.');

  const balance = await wallet.getBalance(user.id);
  const orders = await query('SELECT count(*)::int AS n FROM orders WHERE user_id = $1', [user.id]);
  const lines = [
    '👤 <b>Profil Saya</b>',
    `Nama: ${escapeHtml(user.name || '-')}`,
    user.email ? `Email: ${escapeHtml(user.email)}` : 'Email: belum diatur',
    `Saldo: <b>${rupiah(balance)}</b>`,
    `Total pesanan: ${orders.rows[0].n}`,
    `Kode referral: <code>${escapeHtml(user.referral_code || '-')}</code>`,
  ];
  await replyClean(ctx, lines.join('\n'));
}

function registerProfileHandlers(bot) {
  bot.command('profile', (ctx) => renderProfile(ctx));
  bot.command('profil', (ctx) => renderProfile(ctx));
  bot.callbackQuery('menu:profile', async (ctx) => { await ctx.answerCallbackQuery(); return renderProfile(ctx); });
}

module.exports = { registerProfileHandlers, renderProfile };
