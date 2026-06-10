'use strict';
const { InlineKeyboard } = require('grammy');
const { query } = require('../../db');
const { escapeHtml, rupiah } = require('./_shared');

async function listProducts(ctx) {
  const r = await query(
    `SELECT name, slug, price, product_type FROM products
      WHERE is_active = TRUE ORDER BY created_at DESC LIMIT 12`
  );
  if (!r.rows.length) return ctx.reply('Belum ada produk.');
  const kb = new InlineKeyboard();
  r.rows.forEach((p) => {
    kb.text(`${p.name} — ${rupiah(p.price)}`, `prod:${p.slug}`).row();
  });
  await ctx.reply('📦 <b>Produk Terbaru</b>', { parse_mode: 'HTML', reply_markup: kb });
}

function registerProductHandlers(bot, { PRODUCT_DOMAIN, MINIAPP_VERSION } = {}) {
  bot.command('products', (ctx) => listProducts(ctx));
  bot.callbackQuery('menu:products', async (ctx) => { await ctx.answerCallbackQuery(); return listProducts(ctx); });

  bot.callbackQuery(/^prod:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const slug = ctx.match[1];
    const r = await query(
      `SELECT p.name, p.slug, p.description, p.price, p.product_type,
              count(s.id) FILTER (WHERE s.status='available') AS stock
         FROM products p
         LEFT JOIN product_stocks s ON s.product_id = p.id
        WHERE p.slug = $1 AND p.is_active = TRUE
        GROUP BY p.id`,
      [slug]
    );
    if (!r.rows.length) return ctx.reply('Produk tidak ditemukan.');
    const p = r.rows[0];
    const inStock = Number(p.stock) > 0;
    const text =
      `🛍️ <b>${escapeHtml(p.name)}</b>\n` +
      `Harga: <b>${rupiah(p.price)}</b>\n` +
      `Stok: ${inStock ? '✅ tersedia' : '❌ habis'}\n\n` +
      `${escapeHtml(p.description || '').slice(0, 600)}`;
    const kb = new InlineKeyboard()
      .webApp('🛒 Beli Sekarang', `${PRODUCT_DOMAIN}/produk/${encodeURIComponent(slug)}?miniapp=1&v=${MINIAPP_VERSION || '1'}`);
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  });
}

module.exports = { registerProductHandlers, listProducts };
