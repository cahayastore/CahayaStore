const API = 'https://api.cahayastore.me/api';
const POLL_MS = 4500;
const PAID = ['paid', 'completed', 'success', 'settlement', 'capture'];

const rupiah = (v) => {
  const n = Number(v || 0);
  return n <= 0 ? 'Gratis' : 'Rp' + n.toLocaleString('id-ID');
};
const text = (v, f = '') => String(v ?? f).trim();
function esc(v) {
  return text(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
const root = () => document.querySelector('[data-pay]');

/* ── Routing ─────────────────────────────────────────── */
function route() {
  const path = location.pathname;
  const payment = path.match(/\/payment\/([^/?#]+)/i);
  const order = path.match(/\/order\/([^/?#]+)/i);
  const params = new URLSearchParams(location.search);
  if (payment) return { view: 'payment', orderNo: decodeURIComponent(payment[1]), token: params.get('t') };
  if (order) return { view: 'order', orderNo: decodeURIComponent(order[1]), token: params.get('t') };
  // Direct buy: /?product=<id> (legacy) or /?buy=<id>
  const buy = params.get('buy') || params.get('product');
  if (buy) return { view: 'create', productId: buy, qty: Number(params.get('qty') || 1) };
  return { view: 'empty' };
}

/* ── API ─────────────────────────────────────────────── */
async function api(path, opts) {
  const res = await fetch(API + path, opts);
  let body = null; try { body = await res.json(); } catch { /* */ }
  if (!res.ok) throw new Error((body && body.message) || `HTTP ${res.status}`);
  return body;
}

/* ── Create order → redirect to payment ─────────────── */
async function createOrder(productId, qty) {
  root().innerHTML = `<div class="pay-card pay-center">
    <div class="pay-spinner"></div>
    <h2>Menyiapkan pembayaran…</h2>
    <p class="muted">Mohon tunggu sebentar.</p>
    <div class="pay-email" data-email-form hidden>
      <p>Masukkan email untuk menerima produk:</p>
      <input type="email" placeholder="email@kamu.com" data-email />
      <button class="btn btn-primary" data-email-submit>Lanjut ke Pembayaran</button>
      <div class="pay-err" data-err></div>
    </div>
  </div>`;

  // Guest checkout needs an email. Ask inline (no separate checkout page).
  const saved = localStorage.getItem('cs_guest_email') || '';
  const form = root().querySelector('[data-email-form]');
  root().querySelector('.pay-spinner').style.display = 'none';
  root().querySelector('h2').textContent = 'Hampir selesai';
  root().querySelector('h2').nextElementSibling.remove();
  form.hidden = false;
  const input = form.querySelector('[data-email]');
  input.value = saved;
  const submit = form.querySelector('[data-email-submit]');
  const err = form.querySelector('[data-err]');

  async function go() {
    const email = text(input.value);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = 'Email tidak valid.'; return; }
    localStorage.setItem('cs_guest_email', email);
    submit.disabled = true; submit.textContent = 'Memproses…'; err.textContent = '';
    try {
      const r = await api('/public/web-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, paymentMethod: 'qris', items: [{ productId, quantity: qty }] }),
      });
      const d = r.data;
      if (d.qrisData) sessionStorage.setItem('cs_qris_' + d.orderId, d.qrisData);
      location.replace(`/payment/${encodeURIComponent(d.orderId)}?t=${encodeURIComponent(d.accessToken)}`);
    } catch (e) {
      err.textContent = e.message;
      submit.disabled = false; submit.textContent = 'Lanjut ke Pembayaran';
    }
  }
  submit.addEventListener('click', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

/* ── Payment QRIS page (poll) ───────────────────────── */
async function renderPayment(orderNo, token) {
  let status = 'pending';
  let order = null;

  async function load() {
    const r = await api(`/payment-gateways/status/${encodeURIComponent(orderNo)}`);
    status = String(r.data.status || 'pending').toLowerCase();
    return r.data;
  }

  function paint() {
    const paid = PAID.includes(status);
    root().innerHTML = `<div class="pay-card pay-center">
      <div class="pay-badge ${paid ? 'ok' : 'wait'}">${paid ? '✓ Pembayaran diterima' : '⏳ Menunggu pembayaran'}</div>
      <h2>Pembayaran QRIS</h2>
      <p class="muted">Order ${esc(orderNo)}</p>
      ${paid ? '' : `<div class="pay-qris" data-qris>Memuat QRIS…</div>`}
      <p class="pay-hint">${paid ? 'Mengarahkan ke produk kamu…' : 'Scan QRIS di atas dengan aplikasi e-wallet / m-banking. Status diperbarui otomatis.'}</p>
    </div>`;
  }

  try { order = await load(); } catch (e) { root().innerHTML = errCard(e.message); return; }
  paint();

  if (PAID.includes(status)) {
    location.replace(`/order/${encodeURIComponent(orderNo)}?t=${encodeURIComponent(token || '')}`);
    return;
  }

  // QRIS data lives on the create response; for reloads we show a generic notice.
  const qris = root().querySelector('[data-qris]');
  if (qris) {
    const stored = sessionStorage.getItem('cs_qris_' + orderNo);
    if (stored) {
      qris.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(stored)}" alt="QRIS" width="240" height="240" />`;
    } else {
      qris.innerHTML = '<div class="muted">QRIS akan muncul setelah order dibuat. Jika kosong, hubungi admin.</div>';
    }
  }

  const timer = setInterval(async () => {
    try {
      await load();
      if (PAID.includes(status)) {
        clearInterval(timer);
        location.replace(`/order/${encodeURIComponent(orderNo)}?t=${encodeURIComponent(token || '')}`);
      }
    } catch { /* keep polling */ }
  }, POLL_MS);
}

/* ── Order / credentials page ───────────────────────── */
async function renderOrder(orderNo, token) {
  async function load() {
    return api(`/public/web-checkout/credentials/${encodeURIComponent(orderNo)}?token=${encodeURIComponent(token || '')}`);
  }
  let data;
  try { data = (await load()).data; } catch (e) { root().innerHTML = errCard(e.message); return; }

  if (data.status !== 'paid') {
    root().innerHTML = `<div class="pay-card pay-center">
      <div class="pay-badge wait">⏳ Menunggu pembayaran</div>
      <h2>${esc(data.productName || 'Pesanan')}</h2>
      <p class="muted">Order ${esc(orderNo)} — status: ${esc(data.status)}</p>
      <p class="pay-hint">Halaman akan otomatis menampilkan produk setelah pembayaran dikonfirmasi.</p>
    </div>`;
    setTimeout(() => renderOrder(orderNo, token), POLL_MS);
    return;
  }

  const c = data.credentials;
  let body = '';
  if (!c) {
    body = `<div class="pay-deliver">
      <p>Pembayaran berhasil. Produk sedang diproses admin dan akan dikirim ke email <b>kamu</b>.</p>
    </div>`;
  } else if (c.type === 'link') {
    body = `<div class="pay-deliver">
      <div class="pay-cred-label">Link Produk</div>
      <a class="btn btn-primary pay-open" href="${esc(c.url)}" target="_blank" rel="noopener">Buka Link →</a>
      <button class="btn btn-ghost" data-copy="${esc(c.url)}">Salin Link</button>
    </div>`;
  } else if (c.type === 'code') {
    body = `<div class="pay-deliver">
      <div class="pay-cred-label">Kode</div>
      <div class="pay-cred-box">${esc(c.code || c.content)}</div>
      <button class="btn btn-ghost" data-copy="${esc(c.code || c.content)}">Salin Kode</button>
    </div>`;
  } else if (c.type === 'account') {
    body = `<div class="pay-deliver">
      <div class="pay-cred-label">Detail Akun</div>
      <pre class="pay-cred-box pay-pre">${esc(c.content)}</pre>
      <button class="btn btn-ghost" data-copy="${esc(c.content)}">Salin</button>
    </div>`;
  } else {
    body = `<div class="pay-deliver">
      <div class="pay-cred-label">Detail Produk</div>
      <pre class="pay-cred-box pay-pre">${esc(c.content)}</pre>
      <button class="btn btn-ghost" data-copy="${esc(c.content)}">Salin</button>
    </div>`;
  }

  root().innerHTML = `<div class="pay-card pay-center">
    <div class="pay-badge ok">✓ Pembayaran berhasil</div>
    <h2>${esc(data.productName || 'Produk kamu')}</h2>
    <p class="muted">Order ${esc(orderNo)}</p>
    ${body}
    <p class="pay-hint">Simpan halaman ini. Butuh bantuan? Hubungi admin Cahaya Store.</p>
  </div>`;

  root().querySelectorAll('[data-copy]').forEach((b) => {
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Tersalin ✓'; }
      catch { /* */ }
    });
  });
}

function errCard(msg) {
  return `<div class="pay-card pay-center">
    <div class="pay-badge err">Terjadi kesalahan</div>
    <h2>Tidak dapat memuat</h2>
    <p class="muted">${esc(msg)}</p>
    <a class="btn btn-primary" href="https://cahayastore.me/">Kembali ke Toko</a>
  </div>`;
}

function renderEmpty() {
  root().innerHTML = `<div class="pay-card pay-center">
    <h2>Tidak ada pesanan</h2>
    <p class="muted">Mulai belanja di toko untuk membuat pesanan.</p>
    <a class="btn btn-primary" href="https://cahayastore.me/">Ke Toko</a>
  </div>`;
}

const r = route();
if (r.view === 'create') createOrder(r.productId, r.qty);
else if (r.view === 'payment') renderPayment(r.orderNo, r.token);
else if (r.view === 'order') renderOrder(r.orderNo, r.token);
else renderEmpty();
