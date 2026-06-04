/* Cahaya Store Admin Panel — vanilla JS SPA */
const API = 'https://api.cahayastore.me';
const TOKEN_KEY = 'cs_admin_token';
const USER_KEY = 'cs_admin_user';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
};

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function getUser() { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } }
function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const tok = getToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const r = await fetch(API + path, { ...opts, headers });
  let body = null;
  try { body = await r.json(); } catch { /* ignore */ }
  if (r.status === 401) {
    clearSession();
    location.hash = '#/login';
    throw new Error('Unauthorized');
  }
  if (!r.ok) throw new Error((body && body.message) || `HTTP ${r.status}`);
  return body;
}

/* ---------- Pages ---------- */
function pageLogin() {
  const root = el('div', { class: 'login-wrap' });
  const errBox = el('div', { class: 'alert err', style: 'display:none' });
  const form = el('form', { class: 'login-card' },
    el('h1', {}, 'Cahaya Store'),
    el('p', { class: 'sub' }, 'Masuk ke admin panel'),
    errBox,
    el('div', { class: 'field' },
      el('label', {}, 'Email'),
      el('input', { type: 'email', name: 'email', required: 'required', autocomplete: 'username' })
    ),
    el('div', { class: 'field' },
      el('label', {}, 'Password'),
      el('input', { type: 'password', name: 'password', required: 'required', autocomplete: 'current-password' })
    ),
    el('button', { type: 'submit', class: 'btn primary', style: 'width:100%' }, 'Masuk')
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.style.display = 'none';
    const fd = new FormData(form);
    try {
      const r = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') })
      });
      setSession(r.token, r.user);
      location.hash = '#/dashboard';
    } catch (err) {
      errBox.textContent = err.message;
      errBox.style.display = '';
    }
  });
  root.appendChild(form);
  return root;
}

function shell(content) {
  const user = getUser() || {};
  const navLink = (hash, label) => {
    const a = el('a', { href: '#' + hash }, label);
    if (location.hash === '#' + hash) a.classList.add('active');
    return a;
  };
  const sidebar = el('aside', { class: 'sidebar' },
    el('div', { class: 'brand' },
      el('span', { class: 'logo' }, '⚡'),
      el('span', {}, 'Cahaya Store')
    ),
    el('nav', {},
      navLink('/dashboard', '🏠 Dashboard'),
      navLink('/products', '📦 Produk'),
      navLink('/categories', '🏷️ Kategori'),
      navLink('/orders', '🧾 Pesanan'),
      navLink('/settings', '⚙️ Pengaturan')
    ),
    el('div', { class: 'spacer' }),
    el('div', { class: 'userbox' },
      el('div', {}, user.name || ''),
      el('div', { style: 'font-size:12px' }, user.email || ''),
      el('button', { class: 'btn ghost small', style: 'margin-top:8px', onclick: () => { clearSession(); location.hash = '#/login'; } }, 'Logout')
    )
  );
  const main = el('main', { class: 'main' }, content);
  return el('div', { class: 'layout' }, sidebar, main);
}

async function pageDashboard() {
  const wrap = el('div', {},
    el('div', { class: 'page-head' }, el('h1', {}, 'Dashboard')),
    el('div', { class: 'grid-cards', id: 'kpis' }, el('p', { class: 'muted' }, 'Memuat...'))
  );
  try {
    const r = await api('/api/admin/dashboard');
    const kpis = $('#kpis', wrap);
    kpis.innerHTML = '';
    const add = (label, value) => kpis.appendChild(
      el('div', { class: 'card' },
        el('div', { class: 'kpi-label' }, label),
        el('div', { class: 'kpi-value' }, String(value))
      )
    );
    add('Produk Aktif', r.data.products);
    add('Total Order', r.data.orders);
    add('Pendapatan 24 jam', 'Rp ' + Number(r.data.paid_24h).toLocaleString('id-ID'));
    add('Pengaturan', r.data.settings);
  } catch (e) {
    $('#kpis', wrap).innerHTML = `<div class="alert err">${e.message}</div>`;
  }
  return shell(wrap);
}

async function pageProducts() {
  const wrap = el('div', {},
    el('div', { class: 'page-head' },
      el('h1', {}, 'Produk'),
      el('button', { class: 'btn primary', onclick: () => openProductForm() }, '+ Tambah Produk')
    ),
    el('div', { id: 'tbl' }, el('p', { class: 'muted' }, 'Memuat...'))
  );

  async function reload() {
    const [{ data: products }, { data: cats }] = await Promise.all([
      api('/api/admin/products'),
      api('/api/admin/categories')
    ]);
    const catMap = new Map(cats.map(c => [c.id, c]));
    const t = el('table', { class: 'table' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'Nama'),
        el('th', {}, 'Kategori'),
        el('th', {}, 'Tipe'),
        el('th', {}, 'Harga'),
        el('th', {}, 'Stok'),
        el('th', {}, 'Status'),
        el('th', {}, '')
      ))
    );
    const tb = el('tbody');
    for (const p of products) {
      const cat = p.category_id ? (catMap.get(p.category_id)?.name || '-') : '-';
      tb.appendChild(el('tr', {},
        el('td', {}, p.name),
        el('td', {}, cat),
        el('td', {}, p.product_type),
        el('td', {}, 'Rp ' + Number(p.price).toLocaleString('id-ID')),
        el('td', {}, String(p.stock_count || 0)),
        el('td', {}, el('span', { class: 'badge ' + (p.is_active ? 'ok' : 'danger') }, p.is_active ? 'Aktif' : 'Nonaktif')),
        el('td', {},
          el('div', { class: 'row-actions' },
            el('button', { class: 'btn ghost small', onclick: () => openProductForm(p, cats) }, 'Edit'),
            el('button', {
              class: 'btn danger small', onclick: async () => {
                if (!confirm('Hapus produk ini?')) return;
                await api('/api/admin/products/' + p.id, { method: 'DELETE' });
                reload();
              }
            }, 'Hapus')
          ))
      ));
    }
    t.appendChild(tb);
    $('#tbl', wrap).innerHTML = '';
    $('#tbl', wrap).appendChild(t);
  }

  function openProductForm(p, cats) {
    if (!cats) {
      api('/api/admin/categories').then(r => openProductForm(p, r.data));
      return;
    }
    const f = el('form', {},
      el('div', { class: 'field' }, el('label', {}, 'Nama'), el('input', { name: 'name', value: p?.name || '', required: 'required' })),
      el('div', { class: 'field' }, el('label', {}, 'Slug'), el('input', { name: 'slug', value: p?.slug || '', required: 'required' })),
      el('div', { class: 'field' }, el('label', {}, 'Deskripsi'), el('textarea', { name: 'description', rows: '3' }, p?.description || '')),
      el('div', { class: 'field' }, el('label', {}, 'Harga'), el('input', { name: 'price', type: 'number', value: p?.price || 0, required: 'required' })),
      el('div', { class: 'field' }, el('label', {}, 'Tipe Produk'),
        (() => {
          const s = el('select', { name: 'product_type', required: 'required' });
          for (const opt of ['file', 'account', 'voucher']) {
            const o = el('option', { value: opt }, opt);
            if (p?.product_type === opt) o.selected = true;
            s.appendChild(o);
          }
          return s;
        })()),
      el('div', { class: 'field' }, el('label', {}, 'Kategori'),
        (() => {
          const s = el('select', { name: 'category_id' });
          s.appendChild(el('option', { value: '' }, '— pilih —'));
          for (const c of cats) {
            const o = el('option', { value: c.id }, c.name);
            if (p?.category_id === c.id) o.selected = true;
            s.appendChild(o);
          }
          return s;
        })()),
      el('div', { class: 'field' }, el('label', {},
        el('input', { type: 'checkbox', name: 'is_active', ...(p?.is_active !== false ? { checked: 'checked' } : {}) }),
        ' Aktif'
      ))
    );
    showModal(p ? 'Edit Produk' : 'Tambah Produk', f, async () => {
      const fd = new FormData(f);
      const body = {
        name: fd.get('name'),
        slug: fd.get('slug'),
        description: fd.get('description') || null,
        price: Number(fd.get('price')),
        product_type: fd.get('product_type'),
        category_id: fd.get('category_id') || null,
        is_active: !!fd.get('is_active')
      };
      if (p) await api('/api/admin/products/' + p.id, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/api/admin/products', { method: 'POST', body: JSON.stringify(body) });
      closeModal();
      reload();
    });
  }

  reload();
  return shell(wrap);
}

async function pageCategories() {
  const wrap = el('div', {},
    el('div', { class: 'page-head' },
      el('h1', {}, 'Kategori'),
      el('button', { class: 'btn primary', onclick: () => openForm() }, '+ Tambah Kategori')
    ),
    el('div', { id: 'tbl' }, el('p', { class: 'muted' }, 'Memuat...'))
  );

  async function reload() {
    const { data } = await api('/api/admin/categories');
    const t = el('table', { class: 'table' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Nama'), el('th', {}, 'Slug'), el('th', {}, 'Status'), el('th', {}, '')))
    );
    const tb = el('tbody');
    for (const c of data) {
      tb.appendChild(el('tr', {},
        el('td', {}, c.name),
        el('td', {}, c.slug),
        el('td', {}, el('span', { class: 'badge ' + (c.is_active ? 'ok' : 'danger') }, c.is_active ? 'Aktif' : 'Nonaktif')),
        el('td', {},
          el('div', { class: 'row-actions' },
            el('button', { class: 'btn ghost small', onclick: () => openForm(c) }, 'Edit'),
            el('button', { class: 'btn danger small', onclick: async () => { if (confirm('Hapus?')) { await api('/api/admin/categories/' + c.id, { method: 'DELETE' }); reload(); } } }, 'Hapus')
          ))
      ));
    }
    t.appendChild(tb);
    $('#tbl', wrap).innerHTML = '';
    $('#tbl', wrap).appendChild(t);
  }

  function openForm(c) {
    const f = el('form', {},
      el('div', { class: 'field' }, el('label', {}, 'Nama'), el('input', { name: 'name', value: c?.name || '', required: 'required' })),
      el('div', { class: 'field' }, el('label', {}, 'Slug'), el('input', { name: 'slug', value: c?.slug || '', required: 'required' })),
      el('div', { class: 'field' }, el('label', {},
        el('input', { type: 'checkbox', name: 'is_active', ...(c?.is_active !== false ? { checked: 'checked' } : {}) }), ' Aktif'))
    );
    showModal(c ? 'Edit Kategori' : 'Tambah Kategori', f, async () => {
      const fd = new FormData(f);
      const body = { name: fd.get('name'), slug: fd.get('slug'), is_active: !!fd.get('is_active') };
      if (c) await api('/api/admin/categories/' + c.id, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/api/admin/categories', { method: 'POST', body: JSON.stringify(body) });
      closeModal();
      reload();
    });
  }
  reload();
  return shell(wrap);
}

async function pageOrders() {
  const wrap = el('div', {},
    el('div', { class: 'page-head' }, el('h1', {}, 'Pesanan')),
    el('div', { id: 'tbl' }, el('p', { class: 'muted' }, 'Memuat...'))
  );
  try {
    const { data } = await api('/api/admin/orders');
    const t = el('table', { class: 'table' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'Order No'),
        el('th', {}, 'Pembeli'),
        el('th', {}, 'Total'),
        el('th', {}, 'Status'),
        el('th', {}, 'Bayar'),
        el('th', {}, 'Dibuat')
      ))
    );
    const tb = el('tbody');
    for (const o of data) {
      tb.appendChild(el('tr', {},
        el('td', {}, o.order_no),
        el('td', {}, o.buyer_name || o.buyer_email || '-'),
        el('td', {}, 'Rp ' + Number(o.total_amount).toLocaleString('id-ID')),
        el('td', {}, el('span', { class: 'badge' }, o.status)),
        el('td', {}, el('span', { class: 'badge ' + (o.payment_status === 'paid' ? 'ok' : 'warn') }, o.payment_status)),
        el('td', {}, new Date(o.created_at).toLocaleString('id-ID'))
      ));
    }
    t.appendChild(tb);
    $('#tbl', wrap).innerHTML = '';
    $('#tbl', wrap).appendChild(t);
  } catch (e) {
    $('#tbl', wrap).innerHTML = `<div class="alert err">${e.message}</div>`;
  }
  return shell(wrap);
}

async function pageSettings() {
  const wrap = el('div', {},
    el('div', { class: 'page-head' }, el('h1', {}, 'Pengaturan')),
    el('div', { class: 'card', style: 'margin-bottom:18px' },
      el('h2', { style: 'margin:0 0 10px;font-size:18px' }, 'MyQRIS Payment'),
      el('p', { class: 'muted', style: 'margin:0 0 14px' }, 'Konfigurasi MyQRIS (disimpan terenkripsi).'),
      buildSecretForm('payment.myqris', [
        { name: 'merchant_id', label: 'Merchant ID' },
        { name: 'api_key', label: 'API Key', type: 'password' },
        { name: 'webhook_secret', label: 'Webhook Secret', type: 'password' },
        { name: 'qris_static', label: 'QRIS Statis (opsional)', type: 'textarea' }
      ])
    ),
    el('div', { class: 'card', style: 'margin-bottom:18px' },
      el('h2', { style: 'margin:0 0 10px;font-size:18px' }, 'Telegram Bot'),
      el('p', { class: 'muted', style: 'margin:0 0 14px' }, 'Bot token & secret webhook (disimpan terenkripsi).'),
      buildSecretForm('telegram.bot', [
        { name: 'token', label: 'Bot Token', type: 'password' },
        { name: 'username', label: 'Bot Username (opsional)' },
        { name: 'webhook_secret', label: 'Webhook Secret', type: 'password' }
      ]),
      el('p', { class: 'muted', style: 'margin-top:12px;font-size:12px' },
        'Webhook URL: https://api.cahayastore.me/api/webhooks/telegram/main')
    ),
    el('div', { class: 'card' },
      el('h2', { style: 'margin:0 0 10px;font-size:18px' }, 'Profil Toko'),
      buildPlainForm('store.profile', [
        { name: 'name', label: 'Nama Toko' },
        { name: 'description', label: 'Deskripsi', type: 'textarea' },
        { name: 'telegram_link', label: 'Link Telegram' },
        { name: 'support_email', label: 'Email Support' }
      ])
    )
  );
  return shell(wrap);
}

function buildSecretForm(key, fields) {
  const f = el('form', {});
  for (const fld of fields) {
    f.appendChild(el('div', { class: 'field' },
      el('label', {}, fld.label),
      fld.type === 'textarea'
        ? el('textarea', { name: fld.name, rows: '2' })
        : el('input', { name: fld.name, type: fld.type || 'text', autocomplete: 'off' })
    ));
  }
  const status = el('div', { class: 'alert', style: 'display:none' });
  const btn = el('button', { class: 'btn primary', type: 'submit' }, 'Simpan');
  f.appendChild(status);
  f.appendChild(btn);
  api('/api/admin/settings/' + key).then(r => {
    if (r.value) {
      for (const fld of fields) {
        const inp = f.querySelector(`[name="${fld.name}"]`);
        if (inp && r.value[fld.name] != null) inp.value = r.value[fld.name];
      }
      status.textContent = 'Sudah ada nilai tersimpan (disensor untuk tampilan).';
      status.className = 'alert';
      status.style.display = '';
    }
  }).catch(() => { });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const value = {};
    for (const fld of fields) value[fld.name] = fd.get(fld.name) || null;
    try {
      await api('/api/admin/settings/' + key, { method: 'PUT', body: JSON.stringify({ value, secret: true }) });
      status.textContent = 'Berhasil disimpan.';
      status.className = 'alert ok'; status.style.display = '';
    } catch (err) {
      status.textContent = err.message;
      status.className = 'alert err'; status.style.display = '';
    }
  });
  return f;
}

function buildPlainForm(key, fields) {
  const f = el('form', {});
  for (const fld of fields) {
    f.appendChild(el('div', { class: 'field' },
      el('label', {}, fld.label),
      fld.type === 'textarea'
        ? el('textarea', { name: fld.name, rows: '2' })
        : el('input', { name: fld.name })
    ));
  }
  const status = el('div', { class: 'alert', style: 'display:none' });
  const btn = el('button', { class: 'btn primary', type: 'submit' }, 'Simpan');
  f.appendChild(status); f.appendChild(btn);
  api('/api/admin/settings/' + key).then(r => {
    if (r.value) {
      for (const fld of fields) {
        const inp = f.querySelector(`[name="${fld.name}"]`);
        if (inp && r.value[fld.name] != null) inp.value = r.value[fld.name];
      }
    }
  }).catch(() => { });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const value = {};
    for (const fld of fields) value[fld.name] = fd.get(fld.name) || null;
    try {
      await api('/api/admin/settings/' + key, { method: 'PUT', body: JSON.stringify({ value, secret: false }) });
      status.textContent = 'Berhasil disimpan.';
      status.className = 'alert ok'; status.style.display = '';
    } catch (err) {
      status.textContent = err.message;
      status.className = 'alert err'; status.style.display = '';
    }
  });
  return f;
}

function showModal(title, body, onSave) {
  closeModal();
  const m = el('div', { class: 'modal-bg', id: 'modal' },
    el('div', { class: 'modal' },
      el('h2', {}, title),
      body,
      el('div', { class: 'row' },
        el('button', { class: 'btn ghost', onclick: closeModal }, 'Batal'),
        el('button', { class: 'btn primary', onclick: onSave }, 'Simpan')
      )
    )
  );
  document.body.appendChild(m);
}
function closeModal() { document.getElementById('modal')?.remove(); }

const routes = {
  '#/login': pageLogin,
  '#/dashboard': pageDashboard,
  '#/products': pageProducts,
  '#/categories': pageCategories,
  '#/orders': pageOrders,
  '#/settings': pageSettings
};

async function render() {
  let hash = location.hash || '#/dashboard';
  if (!getToken() && hash !== '#/login') { location.hash = '#/login'; return; }
  if (getToken() && hash === '#/login') { location.hash = '#/dashboard'; return; }
  const fn = routes[hash] || pageDashboard;
  const node = await fn();
  document.getElementById('app').innerHTML = '';
  document.getElementById('app').appendChild(node);
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);
