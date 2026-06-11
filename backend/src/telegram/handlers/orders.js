'use strict';
const { query } = require('../../db');
const { ensureTelegramUser, escapeHtml, rupiah } = require('./_shared');

async function renderOrders(ctx) {
  let user = null;
  try { user = await ensureTelegramUser(ctx.from); } catch { /* ignore */ }
  if (!user) return ctx.reply('Tidak dapat memuat akun kamu.');

  const r = await query(
    `SELECT o.order_no, o.total_amount, o.status, o.payment_status, o.created_at,
            COALESCE(string_agg(p.name, ', '), '') AS products
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.user_id = $1
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 10`,
    [user.id]
  );
  if (!r.rows.length) return ctx.reply('Belum ada pesanan. Gunakan /products untuk mulai belanja.');

  const lines = r.rows.map((o) => {
    const st = o.payment_status === 'paid' ? '✅ Lunas'
      : (o.status === 'expired' ? '⌛ Kedaluwarsa' : '⏳ Menunggu');
    return `• <code>${escapeHtml(o.order_no)}</code> — ${rupiah(o.total_amount)} ${st}\n  ${escapeHtml(o.products || '-')}`;
  });
  await ctx.reply('🧾 <b>Riwayat Pesanan</b>\n\n' + lines.join('\n'), { parse_mode: 'HTML' });
}

function registerOrdersHandlers(bot) {
  bot.command('orders', (ctx) => renderOrders(ctx));
  bot.callbackQuery('menu:orders', async (ctx) => { await ctx.answerCallbackQuery(); return renderOrders(ctx); });
  bot.callbackQuery('v3:orders', async (ctx) => { await ctx.answerCallbackQuery(); return renderOrders(ctx); });
}

module.exports = { registerOrdersHandlers, renderOrders };
