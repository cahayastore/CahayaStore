const API = 'https://api.cahayastore.me/api';
const POLL_MS = 4500;
const PAID = ['paid', 'completed', 'success', 'settlement', 'capture'];
const EXPIRED = ['expired', 'cancelled', 'canceled', 'failed'];

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

/* Format remaining time until an ISO deadline as "mm:ss" (or "00:00" if past). */
function countdownText(expiresAt) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}
const isExpiredStatus = (s) => EXPIRED.includes(String(s || '').toLowerCase());

/* ── Customer session (persists across browsers via login) ──────────── */
const SESSION_KEY = 'cs_session';
function saveSession(d) {
  const sess = { webSessionToken: d.webSessionToken || null };
  if (d.gatewaySession) {
    sess.accessToken = d.gatewaySession.accessToken;
    sess.refreshToken = d.gatewaySession.refreshToken;
    sess.user = d.gatewaySession.user;
  }
  const prev = getSession();
  localStorage.setItem(SESSION_KEY, JSON.stringify({ ...prev, ...sess }));
}
function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || '{}'); } catch { return {}; }
}
function clearSession() { localStorage.removeItem(SESSION_KEY); }
function authHeaders() {
  const s = getSession();
  return s.accessToken ? { Authorization: `Bearer ${s.accessToken}` } : {};
}

/* ── Routing ─────────────────────────────────────────── */
function route() {
  const path = location.pathname;
  const payment = path.match(/\/payment\/([^/?#]+)/i);
  const order = path.match(/\/order\/([^/?#]+)/i);
  const params = new URLSearchParams(location.search);
  if (path.match(/\/login\b/i)) return { view: 'login' };
  if (path.match(/\/akun\b/i) || path.match(/\/riwayat\b/i) || params.get('view') === 'history') return { view: 'history' };
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
    <h2>Memuat produk…</h2>
    <p class="muted">Mohon tunggu sebentar.</p>
  </div>`;

  // Fetch product so we can show a quantity stepper + live subtotal.
  let product = null;
  try {
    const pr = await api(`/products/id/${encodeURIComponent(productId)}`);
    product = pr.data;
  } catch (e) { /* fall back to qty-less flow below */ }

  const maxStock = product ? Math.max(0, Number(product.stock_count) || 0) : 0;
  const price = product ? Number(product.price) || 0 : 0;
  const maxQty = Math.max(1, Math.min(99, maxStock || 99));
  let q = Math.max(1, Math.min(maxQty, Number(qty) || 1));

  const saved = localStorage.getItem('cs_guest_email') || '';
  const soldOut = product && maxStock <= 0;

  root().innerHTML = `<div class="pay-card">
    ${product ? `
    <div class="pay-prod">
      ${product.image_url ? `<img class="pay-prod-img" src="${esc(product.image_url)}" alt="" onerror="this.style.display='none'"/>` : ''}
      <div class="pay-prod-info">
        <h2 class="pay-prod-name">${esc(product.name)}</h2>
        <div class="pay-prod-price" data-unit>${rupiah(price)}</div>
        <div class="pay-prod-stock muted">${soldOut ? 'Stok habis' : 'Tersedia'}</div>
      </div>
    </div>
    ${soldOut ? '' : `
    <div class="pay-qty-row">
      <span class="pay-qty-label">Jumlah</span>
      <div class="pay-qty">
        <button type="button" class="pay-qty-btn" data-dec aria-label="Kurangi">−</button>
        <input class="pay-qty-input" data-qinput type="text" inputmode="numeric" value="${q}" aria-label="Jumlah" />
        <button type="button" class="pay-qty-btn" data-inc aria-label="Tambah">+</button>
      </div>
    </div>
    <div class="pay-qty-hint muted" data-qhint>Maks. ${maxQty} item</div>
    <div class="pay-subtotal">Total <b data-subtotal>${rupiah(price * q)}</b></div>
    `}` : '<h2>Hampir selesai</h2>'}
    <div class="pay-email" data-email-form ${soldOut ? 'hidden' : ''}>
      <p>Masukkan email untuk menerima produk:</p>
      <input type="email" placeholder="email@kamu.com" data-email value="${esc(saved)}" />
      <button class="btn btn-primary" data-email-submit>Lanjut ke Pembayaran</button>
      <div class="pay-err" data-err></div>
    </div>
    ${soldOut ? '<a class="btn btn-primary pay-open" href="/">Belanja lagi →</a>' : ''}
  </div>`;

  if (soldOut) return;

  const form = root().querySelector('[data-email-form]');
  const input = form.querySelector('[data-email]');
  const submit = form.querySelector('[data-email-submit]');
  const err = form.querySelector('[data-err]');
  const qinput = root().querySelector('[data-qinput]');
  const subEl = root().querySelector('[data-subtotal]');
  const qhint = root().querySelector('[data-qhint]');

  function renderQty() {
    if (qinput) qinput.value = String(q);
    if (subEl) subEl.textContent = rupiah(price * q);
  }
  function flashHint(msg) {
    if (!qhint) return;
    qhint.textContent = msg;
    qhint.classList.add('pay-qty-hint--warn');
    setTimeout(() => { qhint.textContent = `Maks. ${maxQty} item`; qhint.classList.remove('pay-qty-hint--warn'); }, 2200);
  }
  const dec = root().querySelector('[data-dec]');
  const inc = root().querySelector('[data-inc]');

  function stepDec() {
    if (q <= 1) return false;
    q = Math.max(1, q - 1); renderQty(); return true;
  }
  function stepInc() {
    if (q >= maxQty) { flashHint(`⚠️ Stok tersedia hanya ${maxQty}`); return false; }
    q = Math.min(maxQty, q + 1); renderQty(); return true;
  }

  // Press-and-hold to auto-repeat, accelerating the longer it's held.
  function bindHold(btn, step) {
    if (!btn) return;
    let holdTimer = null;
    let repeat = null;
    let delay = 260;
    const stop = () => {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      if (repeat) { clearInterval(repeat); repeat = null; }
      delay = 260;
    };
    const startRepeat = () => {
      repeat = setInterval(() => {
        const ok = step();
        if (!ok) { stop(); return; }
        // Accelerate: shorten interval over time down to 40ms.
        if (delay > 45) { delay = Math.max(40, delay - 30); clearInterval(repeat); startRepeat(); }
      }, delay);
    };
    const begin = (e) => {
      // Single immediate step on press; auto-repeat after a short hold.
      if (e.type === 'mousedown' && e.button !== 0) return;
      step();
      holdTimer = setTimeout(startRepeat, 420);
    };
    btn.addEventListener('mousedown', begin);
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); begin(e); }, { passive: false });
    ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach((ev) => btn.addEventListener(ev, stop));
  }
  bindHold(dec, stepDec);
  bindHold(inc, stepInc);
  if (qinput) {
    // Allow only digits while typing.
    qinput.addEventListener('input', () => {
      const digits = qinput.value.replace(/[^0-9]/g, '');
      qinput.value = digits;
      const n = parseInt(digits, 10);
      if (Number.isFinite(n) && subEl) subEl.textContent = rupiah(price * Math.max(1, Math.min(maxQty, n)));
    });
    // Clamp on blur / Enter.
    const commit = () => {
      let n = parseInt(qinput.value, 10);
      if (!Number.isFinite(n) || n < 1) n = 1;
      if (n > maxQty) { n = maxQty; flashHint(`⚠️ Stok tersedia hanya ${maxQty}, disesuaikan.`); }
      q = n; renderQty();
    };
    qinput.addEventListener('blur', commit);
    qinput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
  }

  async function go() {
    // Ensure qty is clamped before sending (in case the field was left focused).
    let nq = parseInt(qinput ? qinput.value : q, 10);
    if (!Number.isFinite(nq) || nq < 1) nq = 1;
    q = Math.min(maxQty, nq);
    const email = text(input.value);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = 'Email tidak valid.'; return; }
    localStorage.setItem('cs_guest_email', email);
    submit.disabled = true; submit.textContent = 'Memproses…'; err.textContent = '';
    try {
      const telegramInitData = (window.CahayaMiniApp && window.CahayaMiniApp.getInitData && window.CahayaMiniApp.getInitData()) || undefined;
      const r = await api('/public/web-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, paymentMethod: 'qris', items: [{ productId, quantity: q }], telegramInitData }),
      });
      const d = r.data;
      if (d.qrisData) sessionStorage.setItem('cs_qris_' + d.orderId, d.qrisData);
      saveSession(d);
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
  let expiresAt = null;

  async function load() {
    const r = await api(`/payment-gateways/status/${encodeURIComponent(orderNo)}`);
    status = String(r.data.status || 'pending').toLowerCase();
    expiresAt = r.data.expiresAt || expiresAt;
    return r.data;
  }

  function paintExpired() {
    root().innerHTML = `<div class="pay-card pay-center">
      <div class="pay-badge expired">⌛ Pembayaran kedaluwarsa</div>
      <h2>Pembayaran QRIS</h2>
      <p class="muted">Order ${esc(orderNo)}</p>
      <div class="pay-notice pay-notice--warn">
        Waktu pembayaran sudah habis dan order ini dibatalkan otomatis. Stok produk sudah dilepas kembali.
      </div>
      <a class="btn btn-primary pay-open" href="/">Belanja lagi →</a>
      <p class="pay-hint">Silakan buat pesanan baru jika masih ingin membeli produk ini.</p>
    </div>`;
  }

  function paint() {
    const paid = PAID.includes(status);
    root().innerHTML = `<div class="pay-card pay-center">
      <div class="pay-badge ${paid ? 'ok' : 'wait'}">${paid ? '✓ Pembayaran diterima' : '⏳ Menunggu pembayaran'}</div>
      <h2>Pembayaran QRIS</h2>
      <p class="muted">Order ${esc(orderNo)}</p>
      ${paid ? '' : `<div class="pay-qris" data-qris>Memuat QRIS…</div>`}
      ${paid ? '' : `<div class="pay-timer" data-timer hidden>Bayar dalam <b data-countdown>--:--</b></div>`}
      <p class="pay-hint">${paid ? 'Mengarahkan ke produk kamu…' : 'Scan QRIS di atas dengan aplikasi e-wallet / m-banking. Status diperbarui otomatis.'}</p>
    </div>`;
  }

  try { order = await load(); } catch (e) { root().innerHTML = errCard(e.message); return; }

  if (isExpiredStatus(status)) { paintExpired(); return; }

  if (PAID.includes(status)) {
    paint();
    location.replace(`/order/${encodeURIComponent(orderNo)}?t=${encodeURIComponent(token || '')}`);
    return;
  }

  paint();

  // Branded QRIS card from the backend (same style as the bot). Works on reload
  // too since it reads the payload from the DB. Falls back to a plain QR image
  // from the stored payload if the branded image fails to load.
  const qris = root().querySelector('[data-qris]');
  if (qris) {
    const stored = sessionStorage.getItem('cs_qris_' + orderNo);
    const brandedSrc = `${API}/public/web-checkout/qr/${encodeURIComponent(orderNo)}.png`;
    const img = new Image();
    img.alt = 'QRIS';
    img.className = 'pay-qris-img';
    img.onload = () => { qris.innerHTML = ''; qris.appendChild(img); };
    img.onerror = () => {
      if (stored) {
        qris.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(stored)}" alt="QRIS" width="300" height="300" />`;
      } else {
        qris.innerHTML = '<div class="muted">QRIS akan muncul setelah order dibuat. Jika kosong, hubungi admin.</div>';
      }
    };
    img.src = brandedSrc;
  }

  let statusTimer = null;
  let tick = null;
  const stop = () => { if (statusTimer) clearInterval(statusTimer); if (tick) clearInterval(tick); };

  // Live countdown to the expiry deadline.
  function refreshCountdown() {
    const box = root().querySelector('[data-timer]');
    const out = root().querySelector('[data-countdown]');
    if (!box || !out) return;
    const cd = countdownText(expiresAt);
    if (!cd) { box.hidden = true; return; }
    box.hidden = false;
    out.textContent = cd;
    if (cd === '00:00') {
      // Deadline reached locally — confirm with the server, then show expired.
      stop();
      load().then(() => { paintExpired(); }).catch(() => paintExpired());
    }
  }
  refreshCountdown();
  tick = setInterval(refreshCountdown, 1000);

  statusTimer = setInterval(async () => {
    try {
      await load();
      if (PAID.includes(status)) {
        stop();
        location.replace(`/order/${encodeURIComponent(orderNo)}?t=${encodeURIComponent(token || '')}`);
      } else if (isExpiredStatus(status)) {
        stop();
        paintExpired();
      }
    } catch { /* keep polling */ }
  }, POLL_MS);
}

/* ── Order / credentials page ───────────────────────── */
async function renderOrder(orderNo, token) {
  const sess = getSession();
  async function load() {
    const ws = sess.webSessionToken ? `&webSessionToken=${encodeURIComponent(sess.webSessionToken)}` : '';
    return api(`/public/web-checkout/credentials/${encodeURIComponent(orderNo)}?token=${encodeURIComponent(token || '')}${ws}`,
      { headers: authHeaders() });
  }
  let data;
  try { data = (await load()).data; } catch (e) { root().innerHTML = errCard(e.message); return; }

  if (isExpiredStatus(data.status)) {
    root().innerHTML = `<div class="pay-card pay-center">
      <div class="pay-badge expired">⌛ Pembayaran kedaluwarsa</div>
      <h2>${esc(data.productName || 'Pesanan')}</h2>
      <p class="muted">Order ${esc(orderNo)}</p>
      <div class="pay-notice pay-notice--warn">
        Order ini sudah kedaluwarsa karena tidak dibayar tepat waktu. Stok sudah dilepas kembali.
      </div>
      <a class="btn btn-primary pay-open" href="/">Belanja lagi →</a>
      <div class="pay-account-links"><a href="/riwayat">Riwayat belanja saya →</a></div>
    </div>`;
    return;
  }

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

  // Render ALL delivered units (qty>1 supported) as a compact descending list.
  // Falls back to the single `credentials` field for older orders.
  const units = Array.isArray(data.items) && data.items.length
    ? data.items
    : (data.credentials ? [data.credentials] : []);

  const copyIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

  function unitValue(c) { return c.url || c.code || c.content || ''; }

  function unitRow(c, idx) {
    const val = unitValue(c);
    const isLink = c.type === 'link';
    const main = isLink
      ? `<a class="pay-cred-link" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.url)}</a>`
      : `<span class="pay-cred-text">${esc(val)}</span>`;
    return `<div class="pay-cred-row">
      <span class="pay-cred-num">${idx + 1}.</span>
      ${main}
      <button class="pay-cred-copy" data-copy="${esc(val)}" title="Salin" aria-label="Salin">${copyIcon}</button>
    </div>`;
  }

  let body;
  if (!units.length) {
    body = `<div class="pay-deliver">
      <p>Pembayaran berhasil. Produk sedang diproses admin dan akan dikirim ke email <b>kamu</b>.</p>
    </div>`;
  } else {
    const allText = units.map(unitValue).filter(Boolean).join('\n');
    body = `<div class="pay-deliver">
      <div class="pay-cred-head">
        <span class="pay-cred-title">${units.length} akun diterima</span>
        <button class="pay-copyall" data-copy="${esc(allText)}">${copyIcon}<span>Salin Semua</span></button>
      </div>
      <div class="pay-cred-list">${units.map((c, i) => unitRow(c, i)).join('')}</div>
    </div>`;
  }

  root().innerHTML = `<div class="pay-card">
    <div class="pay-card-center">
      <div class="pay-badge ok">✓ Pembayaran berhasil</div>
      <h2>${esc(data.productName || 'Produk kamu')}</h2>
      <p class="muted">Order ${esc(orderNo)}</p>
    </div>
    ${body}
    <div class="pay-account-links">
      <a href="/riwayat">Riwayat belanja saya →</a>
    </div>
    <p class="pay-hint">Simpan halaman ini. Butuh bantuan? Hubungi admin Cahaya Store.</p>
  </div>`;

  root().querySelectorAll('[data-copy]').forEach((b) => {
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy);
        b.classList.add('is-copied');
        const label = b.querySelector('span');
        if (label) { const t = label.textContent; label.textContent = 'Tersalin ✓'; setTimeout(() => { label.textContent = t; b.classList.remove('is-copied'); }, 1500); }
        else { b.classList.add('is-copied'); setTimeout(() => b.classList.remove('is-copied'), 1200); }
      } catch { /* */ }
    });
  });

  // Show the "secure your account" panel as a centered overlay (not buried at
  // the bottom), so the buyer actually notices it. Slight delay so they first
  // see the credentials.
  setTimeout(showSetPasswordOverlay, 900);
}

/* Set-password overlay: only for passwordless accounts (we have an accessToken).
   Shown as a centered modal so the buyer notices it. */
function showSetPasswordOverlay() {
  const s = getSession();
  if (!s.accessToken || s.passwordSet) return;
  if (document.querySelector('[data-setpw-overlay]')) return;

  const overlay = document.createElement('div');
  overlay.className = 'pay-modal-bg';
  overlay.setAttribute('data-setpw-overlay', '');
  overlay.innerHTML = `
    <div class="pay-modal" data-setpw>
      <button class="pay-modal-close" data-pw-close aria-label="Tutup">✕</button>
      <div class="pay-modal-icon">🔒</div>
      <h3>Amankan Akun Kamu</h3>
      <p class="pay-hint" style="margin:4px 0 14px">Buat password agar bisa login & lihat riwayat belanja dari perangkat mana pun.</p>
      <input type="password" placeholder="Password baru (min 8)" data-pw />
      <button class="btn btn-primary" data-pw-save style="width:100%;margin-top:10px">Simpan Password</button>
      <div class="pay-err" data-pw-msg></div>
      <button class="pay-modal-skip" data-pw-skip>Nanti saja</button>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-pw-close]').addEventListener('click', close);
  overlay.querySelector('[data-pw-skip]').addEventListener('click', close);

  const input = overlay.querySelector('[data-pw]');
  const btn = overlay.querySelector('[data-pw-save]');
  const msg = overlay.querySelector('[data-pw-msg]');
  const submit = async () => {
    const pw = String(input.value || '');
    if (pw.length < 8) { msg.textContent = 'Password minimal 8 karakter.'; return; }
    btn.disabled = true; btn.textContent = 'Menyimpan…'; msg.textContent = '';
    try {
      await api('/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ newPassword: pw }),
      });
      const sess = getSession(); sess.passwordSet = true;
      localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
      overlay.querySelector('.pay-modal').innerHTML =
        '<div class="pay-modal-icon">✅</div><h3>Password tersimpan</h3>' +
        '<p class="pay-hint" style="margin-top:6px">Sekarang kamu bisa login dengan email & password.</p>' +
        '<button class="btn btn-primary" data-pw-done style="width:100%;margin-top:12px">Selesai</button>';
      overlay.querySelector('[data-pw-done]').addEventListener('click', close);
    } catch (e) {
      msg.textContent = e.message;
      btn.disabled = false; btn.textContent = 'Simpan Password';
    }
  };
  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  setTimeout(() => { try { input.focus(); } catch {} }, 100);
}

/* ── Order history (owner-only) ─────────────────────── */
async function renderHistory() {
  const s = getSession();
  if (!s.accessToken && !s.webSessionToken) {
    root().innerHTML = `<div class="pay-card pay-center">
      <h2>Riwayat Belanja</h2>
      <p class="muted">Masuk dengan akun kamu untuk melihat riwayat & produk yang dibeli.</p>
      <a class="btn btn-primary" href="/login">Masuk Akun</a>
      <p class="pay-hint">Akun dibuat otomatis saat belanja pertama. Buat password di halaman pesanan agar bisa login di sini.</p>
    </div>`;
    return;
  }
  const who = s.user?.email ? `<span class="pay-hist-who">${esc(s.user.email)}</span>` : '';
  root().innerHTML = `<div class="pay-card">
    <div class="pay-hist-head"><h2>Riwayat Belanja</h2>${who}</div>
    <p class="muted" data-h>Memuat…</p>
  </div>`;
  try {
    const ws = s.webSessionToken ? `?webSessionToken=${encodeURIComponent(s.webSessionToken)}` : '';
    const r = await api(`/public/web-checkout/orders${ws}`, { headers: authHeaders() });
    const orders = r.data || [];
    const host = root().querySelector('.pay-card');
    const head = `<div class="pay-hist-head"><h2>Riwayat Belanja</h2>${who}</div>`;
    if (!orders.length) {
      host.innerHTML = head + '<p class="muted">Belum ada pesanan.</p>' + logoutLink();
      bindLogout();
      return;
    }
    host.innerHTML = head + orders.map((o) => {
      const st = String(o.paymentStatus || '').toLowerCase();
      const badge = PAID.includes(st)
        ? { cls: 'ok', label: 'Lunas' }
        : isExpiredStatus(st)
          ? { cls: 'expired', label: 'Kedaluwarsa' }
          : { cls: 'wait', label: 'Menunggu' };
      return `
      <a class="pay-hist-row" href="/order/${encodeURIComponent(o.orderId)}?t=${encodeURIComponent(o.token || '')}">
        <div class="pay-hist-main">
          <span class="pay-hist-name">${esc((o.products || []).join(', ') || o.orderId)}</span>
          <span class="pay-hist-meta">${esc(o.orderId)} · ${rupiah(o.amount)}</span>
        </div>
        <span class="pay-badge ${badge.cls}">${badge.label}</span>
      </a>`;
    }).join('') + logoutLink();
    bindLogout();
  } catch (e) {
    root().querySelector('[data-h]').textContent = e.message;
  }
}

function logoutLink() {
  return '<div class="pay-account-links"><a href="#" data-logout>Keluar</a></div>';
}
function bindLogout() {
  const a = root().querySelector('[data-logout]');
  if (a) a.addEventListener('click', (e) => { e.preventDefault(); clearSession(); location.replace('/login'); });
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

/* ── Login (for customers who already set a password) ── */
function renderLogin() {
  root().innerHTML = `<div class="pay-card pay-center">
    <h2>Masuk Akun</h2>
    <p class="muted">Login untuk melihat riwayat & produk yang sudah dibeli.</p>
    <div class="pay-login">
      <input type="email" placeholder="Email" data-le />
      <input type="password" placeholder="Password" data-lp />
      <button class="btn btn-primary" data-lbtn>Masuk</button>
      <div class="pay-err" data-lmsg></div>
    </div>
    <p class="pay-hint">Belum punya akun? Akun dibuat otomatis saat kamu belanja pertama kali, lalu buat password di halaman pesanan.</p>
  </div>`;
  const email = root().querySelector('[data-le]');
  const pass = root().querySelector('[data-lp]');
  const btn = root().querySelector('[data-lbtn]');
  const msg = root().querySelector('[data-lmsg]');
  const saved = getSession();
  if (saved.user?.email) email.value = saved.user.email;
  async function go() {
    const e = text(email.value); const p = String(pass.value || '');
    if (!e || !p) { msg.textContent = 'Email & password wajib diisi.'; return; }
    btn.disabled = true; btn.textContent = 'Masuk…'; msg.textContent = '';
    try {
      const r = await api('/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: e, password: p }),
      });
      // login returns { token, user }. Store as gateway session.
      const sess = getSession();
      sess.accessToken = r.token; sess.user = r.user; sess.passwordSet = true;
      localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
      location.replace('/riwayat');
    } catch (err) {
      msg.textContent = err.message || 'Login gagal.';
      btn.disabled = false; btn.textContent = 'Masuk';
    }
  }
  btn.addEventListener('click', go);
  pass.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(); });
}

const r = route();
if (r.view === 'create') createOrder(r.productId, r.qty);
else if (r.view === 'payment') renderPayment(r.orderNo, r.token);
else if (r.view === 'order') renderOrder(r.orderNo, r.token);
else if (r.view === 'history') renderHistory();
else if (r.view === 'login') renderLogin();
else renderEmpty();
