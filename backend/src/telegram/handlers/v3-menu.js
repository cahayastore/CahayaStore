'use strict';
/* v3 product menu — Marketku V2 style.
   Product list uses a CUSTOM (reply) keyboard: top menu row + numbered
   product buttons (5 cols) + pagination + utility rows. Pressing a number
   opens the product detail (mapped via session). */
const { InlineKeyboard, Keyboard } = require('grammy');
const { query } = require('../../db');
const { escapeHtml, rupiah } = require('./_shared');
const { replyClean, editOrReply } = require('./_reply');

const PAGE_SIZE = 15;
const NUM_COLUMNS = 5;

function compactName(name, max = 30) {
  const t = String(name || 'Produk').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function wibStamp() {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${p(d.getUTCDate())} ${mon} ${String(d.getUTCFullYear()).slice(-2)} - ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} WIB`;
}

async function fetchProductsPage(page) {
  const r = await query(
    `SELECT p.id, p.name, p.slug, p.price,
            count(s.id) FILTER (WHERE s.status='available') AS stock
       FROM products p
       LEFT JOIN product_stocks s ON s.product_id = p.id
      WHERE p.is_active = TRUE
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT $1 OFFSET $2`,
    [PAGE_SIZE, page * PAGE_SIZE]
  );
  const c = await query('SELECT count(*)::int AS n FROM products WHERE is_active = TRUE');
  return { products: r.rows, total: c.rows[0].n };
}

function buildListText({ userName, products, page, totalPages }) {
  const rows = products.map((p, i) =>
    `${i + 1}. <b>${escapeHtml(compactName(p.name))}</b> — ${rupiah(p.price)} · ${Number(p.stock)} stok`
  );
  const lines = [`<blockquote>✪ Hi ${escapeHtml(userName || 'Kak')}</blockquote>`, '', ...rows];
  if (!products.length) lines.push('Belum ada produk.');
  if (totalPages > 1) lines.push('', `Halaman ${page + 1}/${totalPages}`);
  lines.push('', '<blockquote>Tekan nomor di keyboard untuk pilih produk.</blockquote>');
  lines.push(`<blockquote>⟲ ${wibStamp()}</blockquote>`);
  return lines.join('\n');
}

/* The main menu keyboard (no product numbers) — used outside the product list. */
function menuReplyKeyboard() {
  return new Keyboard()
    .text('📦 Daftar Produk').primary().text('🎟️ Voucher').primary().text('📋 Pesanan Saya').primary().row()
    .text('💰 Top Up').success().text('💸 Tarik Saldo').success().text('🛡️ Garansi').primary().row()
    .text('👨‍💻 Bantuan').danger().row()
    .text('/start').danger().row()
    .resized().persistent();
}

/* The product-list keyboard: top menu + numbered product buttons + pagination
   + utility rows. Mirrors Marketku V2 getProductPageKeyboard. */
function buildListReplyKeyboard({ itemCount, page, totalPages }) {
  const kb = new Keyboard();
  // Top menu row
  kb.text('📦 Daftar Produk').primary().text('🎟️ Voucher').primary().text('📋 Pesanan Saya').primary().row();
  // Number buttons (5 per row)
  for (let i = 1; i <= itemCount; i += 1) {
    kb.text(String(i)).primary();
    if (i % NUM_COLUMNS === 0) kb.row();
  }
  if (itemCount % NUM_COLUMNS !== 0) kb.row();
  // Pagination
  let nav = false;
  if (page > 0) { kb.text('← Kembali').primary(); nav = true; }
  if (page + 1 < totalPages) { kb.text('➡️ Selanjutnya').primary(); nav = true; }
  if (nav) kb.row();
  // Utility rows
  kb.text('💰 Top Up').success().text('💸 Tarik Saldo').success().text('🛡️ Garansi').primary().row();
  kb.text('👨‍💻 Bantuan').danger().row();
  kb.text('/start').danger().row();
  return kb.resized().persistent();
}

async function showProductList(ctx, page = 0, _edit = false) {
  const { products, total } = await fetchProductsPage(page);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const text = buildListText({ userName: ctx.from?.first_name, products, page, totalPages });

  // Remember which products map to which numbers on this page (for number presses).
  if (!ctx.session) ctx.session = {};
  ctx.session.listProductIds = products.map((p) => String(p.id));
  ctx.session.listPage = page;
  ctx.session.listTotalPages = totalPages;

  const reply_markup = buildListReplyKeyboard({ itemCount: products.length, page, totalPages });
  return replyClean(ctx, text, { reply_markup });
}

module.exports = {
  PAGE_SIZE, NUM_COLUMNS, showProductList, fetchProductsPage,
  menuReplyKeyboard, buildListReplyKeyboard, compactName, wibStamp,
};
