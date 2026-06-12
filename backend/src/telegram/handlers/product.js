'use strict';
const { InlineKeyboard } = require('grammy');
const { query } = require('../../db');
const { escapeHtml, rupiah } = require('./_shared');
const { showProductList } = require('./v3-menu');
const { editOrReply, replyClean } = require('./_reply');

async function showProductDetail(ctx, productId, { PRODUCT_DOMAIN, MINIAPP_VERSION } = {}) {
  const r = await query(
    `SELECT p.name, p.slug, p.description, p.price,
            count(s.id) FILTER (WHERE s.status='available') AS stock
       FROM products p
       LEFT JOIN product_stocks s ON s.product_id = p.id
      WHERE p.id = $1 AND p.is_active = TRUE
      GROUP BY p.id`,
    [productId]
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
    .webApp('🛒 Beli Sekarang', `${PRODUCT_DOMAIN}/produk/${encodeURIComponent(p.slug)}?miniapp=1&v=${MINIAPP_VERSION || '1'}`).row()
    .text('← Kembali', 'v3:tolist');
  await editOrReply(ctx, text, { reply_markup: kb });
}

function registerProductHandlers(bot, opts = {}) {
  // /products and the persistent "Menu" button → v3 numbered product list.
  bot.command('products', (ctx) => showProductList(ctx, 0));
  bot.hears('Menu', (ctx) => showProductList(ctx, 0));
  bot.callbackQuery('menu:products', async (ctx) => { await ctx.answerCallbackQuery(); return showProductList(ctx, 0); });

  // Pagination + back-to-list.
  bot.callbackQuery(/^v3:page:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    return showProductList(ctx, Number(ctx.match[1]), true);
  });
  bot.callbackQuery('v3:tolist', async (ctx) => { await ctx.answerCallbackQuery(); return showProductList(ctx, 0, true); });

  // Product detail by id.
  bot.callbackQuery(/^v3:p:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    return showProductDetail(ctx, ctx.match[1], opts);
  });
  // Legacy slug-based detail (from category lists).
  bot.callbackQuery(/^prod:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const r = await query('SELECT id FROM products WHERE slug = $1 AND is_active = TRUE', [ctx.match[1]]);
    if (!r.rows.length) return ctx.reply('Produk tidak ditemukan.');
    return showProductDetail(ctx, r.rows[0].id, opts);
  });

  bot.callbackQuery('v3:info', async (ctx) => {
    await ctx.answerCallbackQuery();
    await editOrReply(ctx,
      'ℹ️ <b>Cahaya Store</b>\nPembayaran QRIS, produk dikirim instan setelah lunas.\n' +
      'Tekan tombol angka untuk lihat produk, lalu "Beli Sekarang".'
    );
  });
}

module.exports = { registerProductHandlers, showProductDetail };
