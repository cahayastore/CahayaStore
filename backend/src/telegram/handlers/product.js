'use strict';
const { InlineKeyboard } = require('grammy');
const { query } = require('../../db');
const { escapeHtml, rupiah } = require('./_shared');
const { showProductList } = require('./v3-menu');
const { editOrReply, replyClean } = require('./_reply');
const { getSetting, KEYS } = require('../../settings.service');

const MAX_QTY = 100;

function stockLabel(n) {
  const v = Number(n);
  return (v > 9999 || v < 0) ? '∞' : String(v);
}

function nowStamp() {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000);
  let h = d.getUTCHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  const pad = (x) => String(x).padStart(2, '0');
  return `${pad(h)}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${ampm}`;
}

/* Rich product detail with quantity stepper + Buy(Saldo)/Buy(Qris). */
async function showProductDetail(ctx, productId, qty = 1) {
  const r = await query(
    `SELECT p.id, p.name, p.description, p.price, p.warranty_enabled, p.warranty_label,
            count(s.id) FILTER (WHERE s.status='available') AS avail,
            count(s.id) FILTER (WHERE s.status='sold') AS sold
       FROM products p
       LEFT JOIN product_stocks s ON s.product_id = p.id
      WHERE p.id = $1 AND p.is_active = TRUE
      GROUP BY p.id`,
    [productId]
  );
  if (!r.rows.length) return replyClean(ctx, 'Produk tidak ditemukan.');
  const p = r.rows[0];
  const avail = Number(p.avail);
  const sold = Number(p.sold);
  const total = avail + sold;
  const maxQty = Math.max(1, Math.min(MAX_QTY, avail));
  const q = Math.max(1, Math.min(maxQty, Number(qty) || 1));
  const totalPrice = Number(p.price) * q;

  const lines = [
    '<b>Detail Pesanan Anda:</b>',
    '',
    `• <b>Produk</b> : ${escapeHtml(p.name)}`,
  ];
  if (p.description) {
    lines.push(`• <b>Deskripsi</b> : ${escapeHtml(String(p.description).slice(0, 600))}`);
  }
  lines.push(
    `• <b>Sisa Stok</b> : ${stockLabel(avail)}`,
    `• <b>Stok Terjual</b> : ${sold}`,
    `• <b>Total Stok</b> : ${stockLabel(total)}`,
  );
  if (p.warranty_enabled) {
    lines.push(`• <b>Garansi</b> : ${escapeHtml(p.warranty_label || 'Ada')}`);
  }
  lines.push(
    '',
    `• <b>Jumlah</b> : ${q}`,
    `• <b>Harga</b> : ${rupiah(p.price)}`,
    `• <b>Total Harga</b> : ${rupiah(totalPrice)}`,
    '',
    `🕒 ${nowStamp()}`,
  );

  const soldOut = avail <= 0;
  const kb = new InlineKeyboard();
  if (!soldOut) {
    kb.text('➖', `v3:p:${productId}:${Math.max(1, q - 1)}`)
      .text('📝', 'v3:noop')
      .text('➕', `v3:p:${productId}:${Math.min(maxQty, q + 1)}`).row()
      .text('💰 Buy (Saldo)', `v3:saldo:${productId}:${q}`)
      .text('💳 Buy (Qris)', `v3:order:${productId}:${q}`).row();
  } else {
    kb.text('❌ Stok Habis', 'v3:noop').row();
  }
  kb.text('← Kembali', 'v3:tolist');

  await editOrReply(ctx, lines.join('\n'), { reply_markup: kb });
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
    return showProductDetail(ctx, match.id, 1);
  });

  // Inline pagination (legacy) + back-to-list.
  bot.callbackQuery(/^v3:page:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    return showProductList(ctx, Number(ctx.match[1]));
  });
  bot.callbackQuery('v3:tolist', async (ctx) => { await ctx.answerCallbackQuery(); return showProductList(ctx, 0); });

  // Product detail by id (inline). Optional qty for the stepper: v3:p:<id>:<qty>
  bot.callbackQuery(/^v3:p:([^:]+)(?::(\d+))?$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    return showProductDetail(ctx, ctx.match[1], ctx.match[2] ? Number(ctx.match[2]) : 1);
  });
  bot.callbackQuery(/^prod:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const r = await query('SELECT id FROM products WHERE slug = $1 AND is_active = TRUE', [ctx.match[1]]);
    if (!r.rows.length) return replyClean(ctx, 'Produk tidak ditemukan.');
    return showProductDetail(ctx, r.rows[0].id, 1);
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
