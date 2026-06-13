/* ════════════════════════════════════════════════════════════════════
   Cahaya Store — Mini App Product Detail renderer
   Standalone, reads ?slug= (or /produk path) and renders the TMA design.
   ════════════════════════════════════════════════════════════════════ */
const API = 'https://api.cahayastore.me/api';
const PAY = 'https://pay.cahayastore.me';

const rupiah = (v) => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
}).format(Number(v || 0));

const text = (v, f = '') => String(v ?? f).trim();

function esc(v) {
  return text(v)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function num(v) { return Number(v || 0); }

function getParam(name) {
  return new URLSearchParams(location.search).get(name);
}

function getProductKey() {
  const q = getParam('slug') || getParam('product');
  if (q) return decodeURIComponent(q);
  const m = location.pathname.match(/\/produk\/([^/?#]+)/i);
  if (m && m[1]) return decodeURIComponent(m[1]);
  return null;
}

function initial(name) {
  const w = text(name).split(/\s+/).filter(Boolean).slice(0, 2);
  return w.map((x) => x[0]?.toUpperCase()).join('') || 'CS';
}

async function fetchProduct(key) {
  // Try slug endpoint first.
  let res = await fetch(`${API}/products/${encodeURIComponent(key)}`, { cache: 'no-store' });
  if (res.status === 404) {
    // Fallback: search list by id/slug.
    res = await fetch(`${API}/products?limit=100`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Gagal memuat produk');
    const json = await res.json();
    const rows = Array.isArray(json?.data) ? json.data : [];
    return rows.find((p) => String(p.id) === String(key) || String(p.slug) === String(key)) || null;
  }
  if (!res.ok) throw new Error('Gagal memuat produk');
  const json = await res.json();
  return json?.data || null;
}

function goBack() {
  const wa = window.Telegram && window.Telegram.WebApp;
  if (history.length > 1) { history.back(); return; }
  location.href = '/miniapp.html';
}

function render(product) {
  const root = document.querySelector('[data-detail]');
  if (!root) return;

  if (!product) {
    root.innerHTML = `
      <div class="tma-detail-empty">
        <b>Produk tidak ditemukan</b>
        <p>Produk mungkin sudah tidak tersedia.</p>
        <a class="tma-detail-emptybtn" href="/miniapp.html">Kembali ke Toko</a>
      </div>`;
    return;
  }

  const price = num(product.price);
  const original = num(product.original_price);
  const hasDiscount = original > price;
  const pct = hasDiscount ? Math.round((1 - price / original) * 100) : 0;
  const stock = num(product.stock_count);
  const category = text(product.category_name || product.product_type, 'Produk Digital');
  const warrantyOn = product.warranty_enabled === true;
  const warranty = text(product.warranty_label, 'Garansi');

  document.title = `${text(product.name)} — Cahaya Store`;

  const media = product.image_url
    ? `<img src="${esc(product.image_url)}" alt="${esc(product.name)}" />`
    : `<span class="tma-detail-initial">${esc(initial(product.name))}</span>`;

  const warrantyHtml = warrantyOn ? `
    <div class="tma-detail-warranty">
      <div class="tma-warranty-row">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="m9 12 2 2 4-4"></path></svg>
        <span class="tma-warranty-title">Garansi</span>
        <span class="tma-warranty-sub">Termasuk</span>
      </div>
      <span class="tma-warranty-pill">${esc(warranty)}</span>
    </div>` : '';

  root.innerHTML = `
    <div class="tma-detail-hero">
      <div class="tma-detail-thumb">
        ${hasDiscount ? `<span class="tma-detail-disc">-${pct}%</span>` : ''}
        ${media}
      </div>
      <div class="tma-detail-head">
        <span class="tma-detail-cat">${esc(category)}</span>
        <h1 class="tma-detail-name">${esc(product.name)}</h1>
        <div class="tma-detail-pricewrap">
          <span class="tma-detail-price">${rupiah(price)}</span>
          ${hasDiscount ? `<span class="tma-detail-price-old">${rupiah(original)}</span>` : ''}
        </div>
      </div>
    </div>

    ${warrantyHtml}

    <div class="tma-detail-desc">
      <h2 class="tma-detail-desc-title">Deskripsi</h2>
      <div class="tma-detail-desc-body">${esc(product.description || 'Produk digital Cahaya Store.')}</div>
    </div>

    <div class="tma-buybar">
      <div class="tma-buybar-total">
        <span class="tma-buybar-total-label">Total mulai dari</span>
        <span class="tma-buybar-total-value">${rupiah(price)}</span>
      </div>
      <button class="tma-buybar-btn" type="button" ${stock > 0 ? '' : 'disabled'} data-buy>
        <span>${stock > 0 ? 'Beli Sekarang' : 'Stok Habis'}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg>
      </button>
    </div>`;

  const buy = root.querySelector('[data-buy]');
  if (buy && stock > 0) {
    buy.addEventListener('click', () => {
      location.href = `/checkout-tma.html?slug=${encodeURIComponent(product.slug || product.id)}`;
    });
  }
}

function bindBack() {
  const btn = document.querySelector('[data-back]');
  if (btn) btn.addEventListener('click', goBack);
  // Telegram native back button
  try {
    const wa = window.Telegram && window.Telegram.WebApp;
    if (wa && wa.BackButton) {
      wa.BackButton.show();
      wa.BackButton.onClick(goBack);
    }
  } catch (e) {}
}

async function init() {
  bindBack();
  const key = getProductKey();
  if (!key) { render(null); return; }
  try {
    render(await fetchProduct(key));
  } catch (e) {
    console.error(e);
    render(null);
  }
}

init();
