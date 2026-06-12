'use strict';
/* v3-style product menu (mirrors Marketku customer-v3 mode):
   - Numbered product list with blockquote greeting + timestamp.
   - Inline keyboard: number buttons (5 cols) + pagination + Pesanan/Info.
   - Persistent reply keyboard with a single "Menu" button. */
const { InlineKeyboard, Keyboard } = require('grammy');
const { query } = require('../../db');
const { escapeHtml, rupiah } = require('./_shared');
const { replyClean, editOrReply } = require('./_reply');

const PAGE_SIZE = 15;
const COLUMNS = 15;

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
  lines.push('', `<blockquote>⟲ ${wibStamp()}</blockquote>`);
  return lines.join('\n');
}

function buildListKeyboard({ products, page, totalPages }) {
  const kb = new InlineKeyboard();
  products.forEach((p, i) => {
    kb.text(String(i + 1), `v3:p:${p.id}`);
    if ((i + 1) % COLUMNS === 0) kb.row();
  });
  if (products.length && products.length % COLUMNS !== 0) kb.row();
  let nav = false;
  if (page > 0) { kb.text('← Kembali', `v3:page:${page - 1}`); nav = true; }
  if (page + 1 < totalPages) { kb.text('➡️ Selanjutnya', `v3:page:${page + 1}`); nav = true; }
  if (nav) kb.row();
  kb.text('☰ Pesanan', 'v3:orders').text('❕ Informasi', 'v3:info').row();
  return kb;
}

function menuReplyKeyboard() {
  return new Keyboard().text('Menu').resized().persistent();
}

async function showProductList(ctx, page = 0, edit = false) {
  const { products, total } = await fetchProductsPage(page);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const text = buildListText({ userName: ctx.from?.first_name, products, page, totalPages });
  const reply_markup = buildListKeyboard({ products, page, totalPages });
  if (edit && ctx.callbackQuery) {
    return editOrReply(ctx, text, { reply_markup });
  }
  return replyClean(ctx, text, { reply_markup });
}

module.exports = {
  PAGE_SIZE, showProductList, fetchProductsPage, menuReplyKeyboard, compactName, wibStamp,
};
