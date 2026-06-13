/* ════════════════════════════════════════════════════════════════════
   Cahaya Store — Mini App Checkout (2 steps)
   Step 1: product config (qty + note)  →  Step 2: QRIS payment + delivery
   Wired to backend: /api/public/web-checkout, /api/payment-gateways/status,
   /api/public/web-checkout/credentials
   ════════════════════════════════════════════════════════════════════ */
const API = 'https://api.cahayastore.me/api';

const rupiah = (v) => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
}).format(Number(v || 0));
const text = (v, f = '') => String(v ?? f).trim();
const esc = (v) => text(v)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const num = (v) => Number(v || 0);

function getParam(name) { return new URLSearchParams(location.search).get(name); }

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

const MAX_QTY = 100;

const state = {
  product: null,
  qty: 1,
  note: '',
  step: 1,
  order: null,      // { orderId, accessToken, amount, qrisData, expiresAt }
  pollTimer: null,
};

async function fetchProduct(key) {
  let res = await fetch(`${API}/products/${encodeURIComponent(key)}`, { cache: 'no-store' });
  if (res.status === 404) {
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

function root() { return document.querySelector('[data-checkout]'); }

function goBack() {
  if (state.step === 2 && !(state.order && state.order.paid)) {
    // From payment back to config.
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
    state.step = 1;
    renderStep1();
    return;
  }
  const slug = state.product?.slug || getProductKey();
  if (slug) { location.href = `/produk-tma.html?slug=${encodeURIComponent(slug)}`; return; }
  location.href = '/miniapp.html';
}

/* ── Stepper header ─────────────────────────────────── */
function stepper(active) {
  return `
    <div class="tma-stepper">
      <div class="tma-step ${active >= 1 ? 'is-active' : ''}">
        <span class="tma-step-ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5Z"></path><path d="m2 17 10 5 10-5"></path><path d="m2 12 10 5 10-5"></path></svg>
        </span>
        <span class="tma-step-tx"><b>Step 1</b><small>Produk</small></span>
      </div>
      <span class="tma-step-line"></span>
      <div class="tma-step ${active >= 2 ? 'is-active' : ''}">
        <span class="tma-step-ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"></rect><path d="m22 7-10 5L2 7"></path></svg>
        </span>
        <span class="tma-step-tx"><b>Step 2</b><small>Pembayaran</small></span>
      </div>
    </div>`;
}

function productThumb(p) {
  return p.image_url
    ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" />`
    : `<span class="tma-co-initial">${esc(initial(p.name))}</span>`;
}

/* ── Step 1: product config ─────────────────────────── */
function renderStep1() {
  state.step = 1;
  const p = state.product;
  const price = num(p.price);
  const warrantyOn = p.warranty_enabled === true;
  const warranty = text(p.warranty_label, 'Garansi');
  const category = text(p.category_name || p.product_type, 'Produk Digital');
  const subtotal = price * state.qty;

  root().innerHTML = `
    ${stepper(1)}
    <div class="tma-co-card">
      <div class="tma-co-thumb">${productThumb(p)}</div>
      <div class="tma-co-info">
        <h2 class="tma-co-name">${esc(p.name)}</h2>
        <div class="tma-co-tags">
          <span class="tma-co-tag">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5Z"></path><path d="m2 17 10 5 10-5"></path></svg>
            ${esc(category)}
          </span>
          ${warrantyOn ? `<span class="tma-co-tag tma-co-tag--warranty">${esc(warranty)}</span>` : ''}
        </div>
        <div class="tma-co-price">${rupiah(price)}</div>
      </div>
    </div>

    <div class="tma-co-field">
      <label>Jumlah pembelian</label>
      <div class="tma-qty">
        <button type="button" class="tma-qty-btn" data-qty-dec aria-label="Kurangi">−</button>
        <span class="tma-qty-val" data-qty-val>${state.qty}</span>
        <button type="button" class="tma-qty-btn" data-qty-inc aria-label="Tambah">+</button>
      </div>
      <p class="tma-co-hint">Produk on-demand, maksimal ${MAX_QTY} item per checkout.</p>
    </div>

    <div class="tma-co-field">
      <label>Catatan untuk seller</label>
      <textarea class="tma-co-note" data-note rows="3" maxlength="500" placeholder="Opsional, misalnya catatan format pengiriman atau instruksi khusus.">${esc(state.note)}</textarea>
    </div>

    <div class="tma-buybar">
      <div class="tma-buybar-total">
        <span class="tma-buybar-total-label">Subtotal</span>
        <span class="tma-buybar-total-value" data-subtotal>${rupiah(subtotal)}</span>
      </div>
      <button class="tma-buybar-btn" type="button" data-next>
        <span>Lanjut ke pembayaran</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg>
      </button>
    </div>`;

  const valEl = root().querySelector('[data-qty-val]');
  const subEl = root().querySelector('[data-subtotal]');
  const refresh = () => {
    valEl.textContent = state.qty;
    subEl.textContent = rupiah(price * state.qty);
  };
  root().querySelector('[data-qty-dec]').addEventListener('click', () => {
    state.qty = Math.max(1, state.qty - 1); refresh();
  });
  root().querySelector('[data-qty-inc]').addEventListener('click', () => {
    state.qty = Math.min(MAX_QTY, state.qty + 1); refresh();
  });
  root().querySelector('[data-note]').addEventListener('input', (e) => {
    state.note = e.target.value;
  });
  root().querySelector('[data-next]').addEventListener('click', startPayment);
}

/* ── Step 2: payment (create order + QRIS + poll) ────── */
function getStoredEmail() {
  try { return localStorage.getItem('cs_guest_email') || ''; } catch { return ''; }
}
function setStoredEmail(v) { try { localStorage.setItem('cs_guest_email', v); } catch {} }

function getTelegramEmail() {
  // Telegram does not expose email; derive a stable placeholder from TG id when available.
  try {
    const wa = window.Telegram && window.Telegram.WebApp;
    const u = wa && wa.initDataUnsafe && wa.initDataUnsafe.user;
    if (u && u.id) return `tg${u.id}@telegram.cahayastore.me`;
  } catch {}
  return '';
}

function renderStep2Email() {
  state.step = 2;
  const saved = getStoredEmail() || getTelegramEmail();
  root().innerHTML = `
    ${stepper(2)}
    <div class="tma-co-field">
      <label>Email untuk kirim produk</label>
      <input type="email" class="tma-co-input" data-email value="${esc(saved)}" placeholder="email@contoh.com" />
      <p class="tma-co-hint">Produk & bukti pembayaran dikirim ke email ini.</p>
      <p class="tma-co-err" data-err></p>
    </div>
    <div class="tma-buybar">
      <div class="tma-buybar-total">
        <span class="tma-buybar-total-label">Total</span>
        <span class="tma-buybar-total-value">${rupiah(num(state.product.price) * state.qty)}</span>
      </div>
      <button class="tma-buybar-btn" type="button" data-pay>
        <span>Buat pembayaran</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg>
      </button>
    </div>`;
  const input = root().querySelector('[data-email]');
  const err = root().querySelector('[data-err]');
  if (saved) setTimeout(() => createOrder(saved), 50); // auto-proceed if we already know email
  root().querySelector('[data-pay]').addEventListener('click', () => {
    const email = text(input.value);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = 'Email tidak valid.'; return; }
    setStoredEmail(email);
    createOrder(email);
  });
}

async function startPayment() {
  const email = getStoredEmail() || getTelegramEmail();
  if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    state.step = 2;
    renderPaymentLoading();
    createOrder(email);
  } else {
    renderStep2Email();
  }
}

function renderPaymentLoading() {
  root().innerHTML = `${stepper(2)}<div class="tma-detail-loading">Membuat pembayaran…</div>`;
}

async function createOrder(email) {
  renderPaymentLoading();
  try {
    const telegramInitData = (window.CahayaMiniApp && window.CahayaMiniApp.getInitData && window.CahayaMiniApp.getInitData()) || undefined;
    const res = await fetch(`${API}/public/web-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        paymentMethod: 'qris',
        items: [{ productId: state.product.id, quantity: state.qty }],
        customerNote: state.note || undefined,
        telegramInitData,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.message || 'Gagal membuat order.');
    state.order = {
      orderId: json.data.orderId,
      accessToken: json.data.accessToken,
      amount: json.data.amount,
      qrisData: json.data.qrisData,
      expiresAt: json.data.expiresAt,
      paid: false,
    };
    renderPayment();
    startPolling();
  } catch (e) {
    root().innerHTML = `${stepper(2)}
      <div class="tma-detail-empty">
        <b>Gagal membuat pembayaran</b>
        <p>${esc(e.message)}</p>
        <button class="tma-detail-emptybtn" type="button" data-retry>Coba lagi</button>
      </div>`;
    root().querySelector('[data-retry]').addEventListener('click', () => { state.step = 1; renderStep1(); });
  }
}

function renderPayment() {
  const o = state.order;
  const qrImg = o.qrisData
    ? `<img src="https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(o.qrisData)}" alt="QRIS" width="260" height="260" />`
    : `<div class="tma-co-hint">QRIS belum tersedia. Hubungi admin.</div>`;
  root().innerHTML = `
    ${stepper(2)}
    <div class="tma-pay">
      <h2 class="tma-pay-title">Pembayaran QRIS</h2>
      <div class="tma-pay-amount">${rupiah(o.amount)}</div>
      <div class="tma-pay-qr">${qrImg}</div>
      <div class="tma-pay-status" data-pay-status>
        <span class="tma-pay-dot"></span> Menunggu pembayaran…
      </div>
      <p class="tma-co-hint" style="text-align:center">Scan dengan e-wallet / m-banking. Status diperbarui otomatis.</p>
      <div class="tma-pay-order">Order: <b>${esc(o.orderId)}</b></div>
    </div>`;
}

function renderPaid(credentials, productName) {
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  let credHtml = '';
  if (credentials) {
    if (credentials.type === 'link') {
      credHtml = `<a class="tma-cred-link" href="${esc(credentials.url)}" target="_blank" rel="noopener">Buka produk →</a>`;
    } else {
      credHtml = `<pre class="tma-cred-box">${esc(credentials.content || credentials.code || '')}</pre>`;
    }
  } else {
    credHtml = `<p class="tma-co-hint">Produk sedang diproses. Cek email kamu untuk detail.</p>`;
  }
  root().innerHTML = `
    <div class="tma-paid">
      <div class="tma-paid-ic">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>
      </div>
      <h2 class="tma-paid-title">Pembayaran berhasil!</h2>
      <p class="tma-co-hint" style="text-align:center">${esc(productName || state.product.name)}</p>
      <div class="tma-cred">${credHtml}</div>
      <button class="tma-detail-emptybtn" type="button" data-home>Kembali ke Toko</button>
    </div>`;
  root().querySelector('[data-home]').addEventListener('click', () => { location.href = '/miniapp.html'; });
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  const o = state.order;
  const tick = async () => {
    try {
      const res = await fetch(`${API}/payment-gateways/status/${encodeURIComponent(o.orderId)}`, { cache: 'no-store' });
      const json = await res.json();
      const st = json?.data?.status;
      if (st === 'paid') {
        o.paid = true;
        // Fetch delivered credentials.
        let cred = null, pname = null;
        try {
          const cr = await fetch(`${API}/public/web-checkout/credentials/${encodeURIComponent(o.orderId)}?token=${encodeURIComponent(o.accessToken)}`, { cache: 'no-store' });
          const cj = await cr.json();
          if (cj.success) { cred = cj.data.credentials; pname = cj.data.productName; }
        } catch {}
        renderPaid(cred, pname);
      } else if (st === 'expired' || st === 'failed') {
        if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
        const el = root().querySelector('[data-pay-status]');
        if (el) el.innerHTML = '<span class="tma-pay-dot tma-pay-dot--err"></span> Pembayaran kedaluwarsa. Ulangi checkout.';
      }
    } catch {}
  };
  state.pollTimer = setInterval(tick, 4000);
  tick();
}

function bindBack() {
  const btn = document.querySelector('[data-back]');
  if (btn) btn.addEventListener('click', goBack);
  try {
    const wa = window.Telegram && window.Telegram.WebApp;
    if (wa && wa.BackButton) { wa.BackButton.show(); wa.BackButton.onClick(goBack); }
  } catch {}
}

async function init() {
  bindBack();
  const key = getProductKey();
  const sub = document.querySelector('[data-product-subtitle]');
  if (!key) { root().innerHTML = '<div class="tma-detail-empty"><b>Produk tidak ditemukan</b></div>'; return; }
  try {
    state.product = await fetchProduct(key);
    if (!state.product) throw new Error('not found');
    if (sub) sub.textContent = state.product.name;
    renderStep1();
  } catch (e) {
    root().innerHTML = '<div class="tma-detail-empty"><b>Produk tidak ditemukan</b><p>Produk mungkin sudah tidak tersedia.</p><a class="tma-detail-emptybtn" href="/miniapp.html">Kembali ke Toko</a></div>';
  }
}

init();
