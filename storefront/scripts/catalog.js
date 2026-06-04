const fallbackProducts = [
  { name: 'Akun Kopi Kenangan', brand: 'kopi kenangan ♥', price: 12000, rating: '4.9 (2.3k+)', logo: 'logo-kopi' },
  { name: 'Akun Tomoro Coffee', brand: 'TOMORO COFFEE', price: 10000, rating: '4.9 (1.8k+)', logo: 'logo-tomoro' },
  { name: 'Akun KFC', brand: 'KFC', price: 15000, rating: '4.8 (1.5k+)', logo: 'logo-kfc' },
  { name: 'Akun Janji Jiwa', brand: 'Janji Jiwa', price: 9000, rating: '4.9 (1.2k+)', logo: 'logo-janji' },
  { name: 'Akun Chagee', brand: 'CHAGEE', price: 12000, rating: '4.9 (980+)', logo: 'logo-chagee' },
  { name: 'Akun Chatime', brand: 'Chatime', price: 11000, rating: '4.9 (850+)', logo: 'logo-chatime' },
];

const categories = [
  ['☕', 'Kopi Kenangan'], ['Ⓣ', 'Tomoro Coffee'], ['🍗', 'KFC'], ['☕', 'Janji Jiwa'], ['🌺', 'Chagee'], ['💜', 'Chatime'],
];

const rupiah = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value || 0);

function logoClass(name = '') {
  const lower = name.toLowerCase();
  if (lower.includes('kopi')) return 'logo-kopi';
  if (lower.includes('tomoro')) return 'logo-tomoro';
  if (lower.includes('kfc')) return 'logo-kfc';
  if (lower.includes('janji')) return 'logo-janji';
  if (lower.includes('chagee')) return 'logo-chagee';
  if (lower.includes('chatime')) return 'logo-chatime';
  return 'logo-tomoro';
}

function normalizeProduct(product) {
  return {
    name: product.name,
    brand: product.name?.replace(/^Akun\s+/i, '') || 'Cahaya Store',
    price: Number(product.price || product.price_amount || 0),
    rating: product.rating || '4.9 (baru)',
    logo: logoClass(product.name),
  };
}

function renderCategories() {
  const wrap = document.querySelector('[data-categories]');
  wrap.innerHTML = categories.map(([icon, name]) => `
    <a class="category-card" href="#products" aria-label="Kategori ${name}">
      <div class="mark">${icon}</div><b>${name}</b><small>Lihat Produk</small>
    </a>`).join('');
}

function productCard(product, idx) {
  return `<article class="product-card">
    ${idx < 3 ? '<span class="ribbon">🔥 TERLARIS</span>' : ''}
    <div class="product-logo ${product.logo}">${product.brand}</div>
    <h3>${product.name}</h3><p>Garansi 30 Hari</p>
    <div class="price">${rupiah(product.price)}</div>
    <div class="rating">★ <span>${product.rating}</span></div>
    <a class="btn btn-primary" href="https://pay.cahayastore.me">Beli Sekarang</a>
  </article>`;
}

async function loadProducts() {
  try {
    const res = await fetch('https://api.cahayastore.me/api/products', { cache: 'no-store' });
    const json = await res.json();
    const data = Array.isArray(json?.data) ? json.data : json;
    const products = data?.slice(0, 6).map(normalizeProduct) || [];
    const hasCafeAccounts = products.some((item) => /(kopi|tomoro|kfc|janji|chagee|chatime)/i.test(item.name));
    return products.length >= 6 && hasCafeAccounts ? products : fallbackProducts;
  } catch {
    return fallbackProducts;
  }
}

async function initCatalog() {
  renderCategories();
  const products = await loadProducts();
  document.querySelector('[data-products]').innerHTML = products.map(productCard).join('');
}

initCatalog();
