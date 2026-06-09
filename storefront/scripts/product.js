const API = 'https://api.cahayastore.me/api';

const rupiah = (v) => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
}).format(Number(v || 0));

const text = (v, f = '') => String(v ?? f).trim();

function esc(v) {
  return text(v)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function getParam(name) {
  return new URLSearchParams(location.search).get(name);
}

// Slug from /produk/<slug> path; fallback to ?product=<id|slug>.
function getProductKey() {
  const m = location.pathname.match(/\/produk\/([^/?#]+)/i);
  if (m && m[1]) return { type: 'slug', value: decodeURIComponent(m[1]) };
  const q = getParam('product');
  if (q) return { type: 'id', value: q };
  return null;
}

function initial(name) {
  const w = text(name).split(/\s+/).filter(Boolean).slice(0, 2);
  return w.map((x) => x[0]?.toUpperCase()).join('') || 'CS';
}

function num(v) { return Number(v || 0); }

async function fetchProductBySlug(slug) {
  const res = await fetch(`${API}/products/${encodeURIComponent(slug)}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Gagal memuat produk');
  const json = await res.json();
  return json?.data || null;
}

async function fetchProductById(id) {
  // Fallback for legacy ?product=<id> links.
  const res = await fetch(`${API}/products?limit=100`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Gagal memuat produk');
  const json = await res.json();
  const rows = Array.isArray(json?.data) ? json.data : [];
  return rows.find((p) => String(p.id) === String(id) || String(p.slug) === String(id)) || null;
}

function render(product) {
  const wrap = document.querySelector('[data-detail]');
  if (!wrap) return;

  if (!product) {
    wrap.innerHTML = `<div class="pd-error">
      <b>Produk tidak ditemukan</b>
      <p>Produk mungkin sudah tidak tersedia. Kembali ke toko untuk melihat katalog terbaru.</p>
      <a class="pd-buy" style="max-width:220px;margin:14px auto 0" href="https://cahayastore.me/">Ke Beranda</a>
    </div>`;
    return;
  }

  const price = num(product.price);
  const original = num(product.original_price);
  const hasDiscount = original > price;
  const pct = hasDiscount ? Math.round((1 - price / original) * 100) : 0;
  const stock = num(product.stock_count);
  const sold = num(product.sold_count);
  const category = text(product.category_name || product.product_type, 'Produk Digital');

  const crumb = document.querySelector('[data-crumb-cat]');
  if (crumb) crumb.textContent = category;
  document.title = `${text(product.name)} — Cahaya Store`;

  const media = product.image_url
    ? `<img src="${esc(product.image_url)}" alt="${esc(product.name)}" />`
    : `<div class="pd-initial">${esc(initial(product.name))}</div>`;

  const stockHtml = stock > 0
    ? `<div class="pd-stock ok">✓ Stok tersedia (${stock})</div>`
    : `<div class="pd-stock out">Stok kosong saat ini</div>`;

  wrap.innerHTML = `
    <div class="pd-media">
      ${hasDiscount ? `<span class="pd-discount">-${pct}%</span>` : ''}
      ${media}
    </div>
    <div class="pd-info">
      <span class="pd-cat">${esc(category)}</span>
      <h1 class="pd-name">${esc(product.name)}</h1>
      <div class="pd-meta">
        <span class="pd-rating">★ 0</span><span>·</span>
        <span>${sold > 0 ? `${sold}+ terjual` : 'Produk baru'}</span>
      </div>
      <div class="pd-price-row">
        <span class="pd-price">${rupiah(price)}</span>
        ${hasDiscount ? `<span class="pd-price-old">${rupiah(original)}</span>` : ''}
      </div>
      ${stockHtml}
      <div class="pd-desc">${esc(product.description || 'Produk digital Cahaya Store.')}</div>
      <div class="pd-actions">
        <button class="pd-buy" type="button" ${stock > 0 ? '' : 'disabled'} data-buy>
          ${stock > 0 ? 'Beli Sekarang' : 'Stok Habis'}
        </button>
      </div>
    </div>`;

  const buy = wrap.querySelector('[data-buy]');
  if (buy) {
    buy.addEventListener('click', () => {
      // Checkout happens on the pay subdomain.
      window.location.href = `https://pay.cahayastore.me/?product=${encodeURIComponent(product.id)}`;
    });
  }
}

async function init() {
  const key = getProductKey();
  if (!key) { render(null); return; }
  try {
    const product = key.type === 'slug'
      ? await fetchProductBySlug(key.value)
      : await fetchProductById(key.value);
    render(product);
  } catch (e) {
    console.error(e);
    render(null);
  }
}

init();
