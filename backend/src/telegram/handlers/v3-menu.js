'use strict';
/* v3 product menu — Marketku V2 style.
   Product list uses a CUSTOM (reply) keyboard: top menu row + numbered
   product buttons (5 cols) + pagination + utility rows. Pressing a number
   opens the product detail (mapped via session). */
const { InlineKeyboard, Keyboard } = require('grammy');
const { query } = require('../../db');
const { escapeHtml, rupiah } = require('./_shared');
const { replyClean, editOrReply } = require('./_reply');
const { getSetting, KEYS } = require('../../settings.service');

const PAGE_SIZE = 15;
const NUM_COLUMNS = 6;

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

function buildListText({ products, page, totalPages }) {
  // Table-style list rendered in a monospace <pre> block so columns line up
  // like a real table (No │ Produk │ Harga). Requires parse_mode 'HTML'.
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  const rupiahShort = (v) => {
    const n = Number(v) || 0;
    if (n >= 1000000 && n % 1000000 === 0) return (n / 1000000) + 'jt';
    if (n >= 1000 && n % 1000 === 0) return (n / 1000) + 'rb';
    return n.toLocaleString('id-ID');
  };

  const lines = ['🛍️ <b>LIST PRODUCT</b>', ''];
  if (products.length) {
    const NAME_W = 18; // product name column width
    const cut = (s) => {
      const t = String(s || '').replace(/\s+/g, ' ').trim();
      return t.length > NAME_W ? t.slice(0, NAME_W - 1) + '…' : t.padEnd(NAME_W, ' ');
    };
    const priceW = Math.max(5, ...products.map((p) => rupiahShort(p.price).length));
    const head = `No │ ${'Produk'.padEnd(NAME_W)} │ Harga`;
    const sep = `${'─'.repeat(2)}─┼─${'─'.repeat(NAME_W)}─┼─${'─'.repeat(priceW)}`;
    const body = products.map((p, i) =>
      `${String(i + 1).padStart(2, ' ')} │ ${cut(p.name)} │ ${rupiahShort(p.price).padStart(priceW, ' ')}`
    );
    const table = [head, sep, ...body].join('\n');
    // escapeHtml inside <pre> so names with < > & don't break parsing.
    lines.push(`<pre>${escapeHtml(table)}</pre>`, '', '<i>Tekan nama produk di bawah untuk melihat detail.</i>');
  } else {
    lines.push('Produk sedang kosong.');
  }
  lines.push('', `📄 Halaman ${page + 1} / ${totalPages}`, `📆 ${time} WIB`);
  return lines.join('\n');
}

/* The main menu keyboard (no product numbers) — used outside the product list. */
function menuReplyKeyboard() {
  return new Keyboard()
    .text('📦 Daftar Produk').primary().text('🎟️ Voucher').primary().text('📋 Pesanan Saya').primary().row()
    .text('💰 Top Up').success().text('👨‍💻 Bantuan').danger().row()
    .text('/start').danger().row()
    .resized().persistent();
}

/* The product-list keyboard: top menu + product NAME buttons + pagination
   + utility rows. Pressing a name opens that product's detail. */
function buildListReplyKeyboard({ products, page, totalPages }) {
  const kb = new Keyboard();
  // Top menu row
  kb.text('📦 Daftar Produk').primary().text('🎟️ Voucher').primary().text('📋 Pesanan Saya').primary().row();
  // Product name buttons (3 per row).
  const PRODUCT_COLUMNS = 3;
  products.forEach((p, i) => {
    kb.text(compactName(p.name, 20)).primary();
    if ((i + 1) % PRODUCT_COLUMNS === 0) kb.row();
  });
  if (products.length % PRODUCT_COLUMNS !== 0) kb.row();
  // Pagination
  let nav = false;
  if (page > 0) { kb.text('← Kembali').primary(); nav = true; }
  if (page + 1 < totalPages) { kb.text('➡️ Selanjutnya').primary(); nav = true; }
  if (nav) kb.row();
  // Utility rows
  kb.text('💰 Top Up').success().text('👨‍💻 Bantuan').danger().row();
  kb.text('/start').danger().row();
  return kb.resized().persistent();
}

async function showProductList(ctx, page = 0, opts = {}) {
  const { withBanner = false } = (typeof opts === 'object' && opts) || {};
  const { products, total } = await fetchProductsPage(page);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const text = buildListText({ userName: ctx.from?.first_name, products, page, totalPages });

  // Remember which products map to this page. Name buttons map back to ids by
  // matching the button label (compactName) the user pressed.
  if (!ctx.session) ctx.session = {};
  ctx.session.listProductIds = products.map((p) => String(p.id));
  ctx.session.listProductButtons = products.map((p) => ({ label: compactName(p.name, 20), id: String(p.id) }));
  ctx.session.listPage = page;
  ctx.session.listTotalPages = totalPages;

  const reply_markup = buildListReplyKeyboard({ products, page, totalPages });

  // On the first screen (e.g. /start), merge the banner + list into ONE message:
  // the banner is the photo and the product list is its caption. Caption max is
  // 1024 chars; fall back to a plain text list if it's longer or no banner set.
  if (withBanner && page === 0) {
    let banner = null;
    try { banner = await getSetting(KEYS.BOT_BANNER); } catch (e) {}
    if (banner && banner.image_url && text.length <= 1024) {
      try {
        return await ctx.replyWithPhoto(banner.image_url, {
          caption: text, parse_mode: 'HTML', reply_markup,
        });
      } catch (e) { console.error('[v3 list banner]', e.message); }
    }
  }

  return replyClean(ctx, text, { reply_markup });
}

module.exports = {
  PAGE_SIZE, NUM_COLUMNS, showProductList, fetchProductsPage,
  menuReplyKeyboard, buildListReplyKeyboard, compactName, wibStamp,
};
