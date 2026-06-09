const API_PRODUCTS = 'https://api.cahayastore.me/api/products';

const rupiah = (value) => new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
}).format(Number(value || 0));

const text = (value, fallback = '') => String(value ?? fallback).trim();

function getProductPrice(product) {
  return Number(product.price || product.price_amount || product.sale_price || product.base_price || 0);
}

function getProductStock(product) {
  const candidates = [product.stock, product.available_stock, product.total_stock, product.stock_count];
  const value = candidates.find((item) => item !== undefined && item !== null && item !== '');
  return Number(value || 0);
}

function getCategoryName(product) {
  return text(product.category_name || product.category || product.type, 'Produk Digital');
}

function getOriginalPrice(product) {
  return Number(product.original_price || product.compare_price || 0);
}

function getSoldCount(product) {
  return Number(product.sold_count || product.sold || 0);
}

function normalizeProduct(product) {
  const name = text(product.name, 'Produk Digital');
  const category = getCategoryName(product);
  const stock = getProductStock(product);
  const price = getProductPrice(product);
  const original = getOriginalPrice(product);
  return {
    id: text(product.id || product.slug || name),
    name,
    category,
    price,
    originalPrice: original > price ? original : 0,
    sold: getSoldCount(product),
    stock,
    imageUrl: text(product.image_url || product.image || ''),
    isActive: product.is_active !== false && product.status !== 'inactive',
    description: text(product.description || product.short_description, 'Produk digital Cahaya Store.'),
  };
}

function escapeHtml(value) {
  return text(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function fetchProducts() {
  const res = await fetch(API_PRODUCTS, { cache: 'no-store' });
  if (!res.ok) throw new Error(`API products failed: ${res.status}`);
  const json = await res.json();
  const raw = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  return raw.map(normalizeProduct).filter((product) => product.isActive);
}

function buildCategories(products) {
  const map = new Map();
  for (const product of products) {
    map.set(product.category, (map.get(product.category) || 0) + 1);
  }
  return [...map.entries()].map(([name, count]) => ({ name, count }));
}

function productInitial(name) {
  const words = text(name).split(/\s+/).filter(Boolean).slice(0, 2);
  return words.map((word) => word[0]?.toUpperCase()).join('') || 'CS';
}

function discountPercent(product) {
  if (!product.originalPrice || product.originalPrice <= product.price) return 0;
  return Math.round((1 - product.price / product.originalPrice) * 100);
}

function productMedia(product) {
  if (product.imageUrl) {
    return `<img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" loading="lazy" />`;
  }
  return `<span class="pc-initial">${escapeHtml(productInitial(product.name))}</span>`;
}

function soldLabel(product) {
  if (product.sold > 0) return `${product.sold}+ terjual`;
  return 'Baru';
}

function productCard(product) {
  const pct = discountPercent(product);
  const href = `https://pay.cahayastore.me?product=${encodeURIComponent(product.id)}`;
  return `<article class="product-card" data-product-card data-name="${escapeHtml(product.name.toLowerCase())}" data-category="${escapeHtml(product.category.toLowerCase())}">
    <a class="pc-media" href="${href}" aria-label="${escapeHtml(product.name)}">
      ${pct > 0 ? `<span class="pc-discount">-${pct}%</span>` : ''}
      <button type="button" class="pc-wish" aria-label="Simpan ke wishlist" data-wish>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 21s-6.7-4.35-9.33-8.06C.9 10.27 1.5 6.9 4.2 5.6c2-1 4.2-.3 5.4 1.2L12 9l2.4-2.2c1.2-1.5 3.4-2.2 5.4-1.2 2.7 1.3 3.3 4.67 1.53 7.34C18.7 16.65 12 21 12 21z"/></svg>
      </button>
      ${productMedia(product)}
    </a>
    <div class="pc-body">
      <span class="pc-cat">${escapeHtml(product.category)}</span>
      <h3 class="pc-name">${escapeHtml(product.name)}</h3>
      <div class="pc-price-row">
        <span class="pc-price">${rupiah(product.price)}</span>
        ${pct > 0 ? `<span class="pc-price-old">${rupiah(product.originalPrice)}</span>` : ''}
      </div>
      <div class="pc-foot">
        <span class="pc-rating">★ ${product.sold > 0 ? '0' : '0'}</span>
        <span class="pc-sep">|</span>
        <span class="pc-sold">${escapeHtml(soldLabel(product))}</span>
      </div>
    </div>
  </article>`;
}

function categoryCard(category) {
  return `<a class="category-card" href="#products" data-category-link="${escapeHtml(category.name.toLowerCase())}" aria-label="Kategori ${escapeHtml(category.name)}">
    <div class="mark">${escapeHtml(category.name[0]?.toUpperCase() || 'P')}</div>
    <b>${escapeHtml(category.name)}</b>
    <small>${category.count} produk</small>
  </a>`;
}

function previewCard(product) {
  return `<div class="preview-card">
    <span>${escapeHtml(productInitial(product.name))}</span>
    <b>${escapeHtml(product.name)}</b>
    <small>${rupiah(product.price)} · ${escapeHtml(product.category)}</small>
  </div>`;
}

function setText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
}

function renderProducts(products) {
  const wrap = document.querySelector('[data-products]');
  const empty = document.querySelector('[data-empty-state]');
  if (!wrap) return;
  wrap.innerHTML = products.map(productCard).join('');
  if (empty) empty.hidden = products.length > 0;
  setText('[data-product-status]', products.length ? `${products.length} produk real-time` : 'Belum ada produk aktif');
  setText('[data-product-count]', String(products.length));
}

function renderCategories(products) {
  const categories = buildCategories(products);
  const wrap = document.querySelector('[data-categories]');
  if (wrap) wrap.innerHTML = categories.map(categoryCard).join('');
  setText('[data-category-status]', categories.length ? `${categories.length} kategori` : 'Belum ada kategori');
  setText('[data-category-count]', String(categories.length));
}

function renderPreview(products) {
  const wrap = document.querySelector('[data-featured-preview]');
  if (!wrap) return;
  const featured = products.slice(0, 3);
  wrap.innerHTML = featured.length
    ? featured.map(previewCard).join('')
    : '<div class="preview-card"><span>CS</span><b>Katalog kosong</b><small>Tambahkan produk dari admin panel</small></div>';
}

function bindSearch() {
  const input = document.querySelector('[data-search-input]');
  const form = document.querySelector('[data-search-form]');
  const filter = () => {
    const query = text(input?.value).toLowerCase();
    document.querySelectorAll('[data-product-card]').forEach((card) => {
      const haystack = `${card.dataset.name || ''} ${card.dataset.category || ''}`;
      card.hidden = query ? !haystack.includes(query) : false;
    });
  };
  input?.addEventListener('input', filter);
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    document.querySelector('#products')?.scrollIntoView({ behavior: 'smooth' });
    filter();
  });
}

function bindCategoryFilter() {
  document.querySelectorAll('[data-category-link]').forEach((link) => {
    link.addEventListener('click', () => {
      const category = link.dataset.categoryLink || '';
      const input = document.querySelector('[data-search-input]');
      if (input) input.value = category;
      document.querySelectorAll('[data-product-card]').forEach((card) => {
        card.hidden = (card.dataset.category || '') !== category;
      });
    });
  });
}

function bindWishlist() {
  document.querySelectorAll('[data-wish]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      btn.classList.toggle('is-active');
    });
  });
}

async function initCatalog() {
  try {
    const products = await fetchProducts();
    renderProducts(products);
    renderCategories(products);
    renderPreview(products);
    bindSearch();
    bindCategoryFilter();
    bindWishlist();
  } catch (error) {
    console.error(error);
    renderProducts([]);
    renderCategories([]);
    renderPreview([]);
    setText('[data-product-status]', 'Gagal memuat API produk');
  }
}

initCatalog();
