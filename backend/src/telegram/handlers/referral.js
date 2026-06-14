'use strict';
const { query } = require('../../db');
const { ensureTelegramUser, escapeHtml, rupiah } = require('./_shared');
const { replyClean } = require('./_reply');
const wallet = require('../../wallet.service');

async function renderReferral(ctx) {
  let user = null;
  try { user = await ensureTelegramUser(ctx.from); } catch { /* ignore */ }
  if (!user) return ctx.reply('Tidak dapat memuat akun kamu.');
  if (!user.referral_code) {
    const r = await query('SELECT referral_code FROM users WHERE id = $1', [user.id]);
    user.referral_code = r.rows[0]?.referral_code;
  }

  const me = ctx.me?.username ? `https://t.me/${ctx.me.username}?start=ref_${user.referral_code}` : null;
  const stats = await query(
    'SELECT count(*)::int AS n, COALESCE(sum(bonus_amount),0) AS total FROM referrals WHERE referrer_id = $1',
    [user.id]
  );
  const lines = [
    '🎁 <b>Program Referral</b>',
    `Ajak teman dan dapatkan bonus <b>${rupiah(wallet.REFERRAL_BONUS)}</b> tiap teman menyelesaikan order pertama.`,
    '',
    `Kode kamu: <code>${escapeHtml(user.referral_code || '-')}</code>`,
    me ? `Link: ${me}` : '',
    '',
    `Teman terdaftar: ${stats.rows[0].n} • Total bonus: ${rupiah(stats.rows[0].total)}`,
  ].filter(Boolean);
  await replyClean(ctx, lines.join('\n'));
}

function registerReferralHandlers(bot) {
  bot.command('referral', (ctx) => renderReferral(ctx));
  bot.hears('🎁 Referral', (ctx) => renderReferral(ctx));
  bot.callbackQuery('menu:referral', async (ctx) => { await ctx.answerCallbackQuery(); return renderReferral(ctx); });
}

module.exports = { registerReferralHandlers, renderReferral };
