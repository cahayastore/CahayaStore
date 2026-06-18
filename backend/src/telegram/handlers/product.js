'use strict';
const { InlineKeyboard } = require('grammy');
const { query } = require('../../db');
const { escapeHtml, rupiah } = require('./_shared');
const { showProductList } = require('./v3-menu');
const { editOrReply, replyClean } = require('./_reply');
const { getSetting, KEYS } = require('../../settings.service');

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
  if (!r.rows.length) return replyClean(ctx, 'Produk tidak ditemukan.');
  const p = r.rows[0];
  const inStock = Number(p.stock) > 0;
  const text =
    `🛍️ <b>${escapeHtml(p.name)}</b>\n` +
    `Harga: <b>${rupiah(p.price)}</b>\n` +
    `Status: ${inStock ? '✅ tersedia' : '❌ habis'}\n\n` +
    `${escapeHtml(p.description || '').slice(0, 600)}`;
  // Buy / back stay as inline buttons under the detail message.
  const kb = new InlineKeyboard()
    .text('🛒 Beli Sekarang', `v3:buy:${productId}`).row()
    .text('← Kembali ke Daftar', 'v3:tolist');
  await editOrReply(ctx, text, { reply_markup: kb });
}

function registerProductHandlers(bot, opts = {}) {
  // /products and the persistent menu buttons → v3 numbered product list.
  bot.command('products', (ctx) => showProductList(ctx, 0));
  bot.hears('Menu', (ctx) => showProductList(ctx, 0));
  bot.hears('🛍️ Produk', (ctx) => showProductList(ctx, 0));
  bot.hears('📦 Daftar Produk', (ctx) => showProductList(ctx, 0));
  bot.callbackQuery('menu:products', async (ctx) => { await ctx.answerCallbackQuery(); return showProductList(ctx, 0); });

  // Pagination via custom keyboard buttons.
  bot.hears('➡️ Selanjutnya', (ctx) => {
    const page = (ctx.session && Number(ctx.session.listPage)) || 0;
    return showProductList(ctx, page + 1);
  });
  bot.hears('← Kembali', (ctx) => {
    const page = (ctx.session && Number(ctx.session.listPage)) || 0;
    return showProductList(ctx, Math.max(0, page - 1));
  });

  // Product NAME press → open the mapped product detail for the current page.
  // Matches the button label stored when the list was rendered. Falls through
  // to other handlers if the text isn't a known product button.
  bot.hears(/^.+$/, async (ctx, next) => {
    const buttons = (ctx.session && ctx.session.listProductButtons) || [];
    if (!buttons.length) return typeof next === 'function' ? next() : undefined;
    const pressed = String(ctx.message && ctx.message.text || '').trim();
    const match = buttons.find((b) => b.label === pressed);
    if (!match) return typeof next === 'function' ? next() : undefined;
    return showProductDetail(ctx, match.id, opts);
  });

  // Inline pagination (legacy) + back-to-list.
  bot.callbackQuery(/^v3:page:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    return showProductList(ctx, Number(ctx.match[1]));
  });
  bot.callbackQuery('v3:tolist', async (ctx) => { await ctx.answerCallbackQuery(); return showProductList(ctx, 0); });

  // Product detail by id (inline, e.g. from category lists).
  bot.callbackQuery(/^v3:p:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    return showProductDetail(ctx, ctx.match[1], opts);
  });
  bot.callbackQuery(/^prod:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const r = await query('SELECT id FROM products WHERE slug = $1 AND is_active = TRUE', [ctx.match[1]]);
    if (!r.rows.length) return replyClean(ctx, 'Produk tidak ditemukan.');
    return showProductDetail(ctx, r.rows[0].id, opts);
  });

  bot.callbackQuery('v3:info', async (ctx) => {
    await ctx.answerCallbackQuery();
    const DEFAULT_INFO = 'ℹ️ <b>Cahaya Store</b>\nPembayaran QRIS, produk dikirim instan setelah lunas.\n' +
      'Tekan tombol angka untuk lihat produk, lalu "Beli Sekarang".';
    let infoText = DEFAULT_INFO;
    try {
      const setting = await getSetting(KEYS.BOT_INFO_TEXT);
      if (setting && setting.text) infoText = setting.text;
    } catch (e) {
      console.error('[v3:info] Failed to load setting:', e);
    }
    await editOrReply(ctx, infoText);
  });
}

module.exports = { registerProductHandlers, showProductDetail };
