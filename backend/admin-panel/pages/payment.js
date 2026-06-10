/* Admin page: Pembayaran (MyQRIS + PayHook) */
import { el, toast } from '../dom.js';
import { api, API_BASE, session } from '../api.js';
import { shell } from '../shell.js';

const KEY = 'payment.myqris';
const WEBHOOK_URL = 'https://api.cahayastore.me/api/payment-gateways/webhook/payhook';

function field(label, node, hint) {
  return el('div', { class: 'field' },
    el('label', {}, label),
    node,
    hint ? el('div', { class: 'hint', style: 'margin-top:4px' }, hint) : null
  );
}

/* Collapsible card: clickable header toggles the body open/closed. */
function collapseCard(title, bodyNode, { open = true, subtitle = '' } = {}) {
  const body = el('div', { class: 'collapse-body' }, bodyNode);
  const chevron = el('span', { class: 'collapse-chevron' }, '▾');
  const header = el('button', {
    type: 'button', class: 'collapse-head',
    onclick: () => {
      const isOpen = card.classList.toggle('is-open');
      chevron.textContent = isOpen ? '▾' : '▸';
    },
  },
    el('span', { class: 'collapse-title' },
      el('span', {}, title),
      subtitle ? el('small', {}, subtitle) : null
    ),
    chevron
  );
  const card = el('div', { class: 'card collapse-card' + (open ? ' is-open' : ''), style: 'margin-bottom:16px;padding:0' }, header, body);
  if (!open) chevron.textContent = '▸';
  return card;
}

export async function pagePayment() {
  const merchantName = el('input', { name: 'merchant_name', placeholder: 'Cahaya Store' });
  const qrisStatic = el('textarea', { name: 'qris_static', rows: '4', placeholder: '00020101021126...QRIS string dari merchant' });
  const webhookToken = el('input', { name: 'webhook_token', type: 'text', placeholder: 'token rahasia untuk PayHook' });
  const uniqueMax = el('input', { name: 'unique_max', type: 'number', min: '1', max: '200', value: '50' });

  // Upload QRIS image → auto-decode to EMV string into the textarea.
  const decodeStatus = el('div', { class: 'hint', style: 'margin-top:6px' }, '');
  const qrisFile = el('input', {
    type: 'file', accept: 'image/*', style: 'display:none',
    onchange: async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      decodeStatus.textContent = 'Membaca QRIS…';
      uploadBtn.disabled = true;
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(API_BASE + '/api/admin/uploads/decode-qris', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.getToken()}` },
          body: fd,
        });
        const body = await res.json().catch(() => null);
        if (res.status === 401) { session.clear(); location.hash = '#/login'; return; }
        if (!res.ok || !body?.qris) throw new Error((body && body.message) || `Gagal (HTTP ${res.status})`);
        qrisStatic.value = body.qris;
        decodeStatus.textContent = '✓ QRIS terbaca & dimasukkan otomatis. Jangan lupa Simpan.';
        decodeStatus.style.color = 'var(--color-success)';
      } catch (err) {
        decodeStatus.textContent = err.message;
        decodeStatus.style.color = 'var(--color-danger)';
      } finally {
        uploadBtn.disabled = false;
        e.target.value = '';
      }
    },
  });
  const uploadBtn = el('button', { class: 'btn ghost small', type: 'button', onclick: () => qrisFile.click() }, '📷 Upload Gambar QRIS');

  // Load existing
  api('/api/admin/settings/' + KEY).then((r) => {
    const v = r.value || {};
    if (v.merchant_name) merchantName.value = v.merchant_name;
    if (v.qris_static) qrisStatic.value = v.qris_static;
    if (v.webhook_token) webhookToken.value = v.webhook_token;
    if (v.unique_max) uniqueMax.value = v.unique_max;
  }).catch(() => { /* unset is fine */ });

  const qrisField = el('div', { class: 'field' },
    el('label', {}, 'QRIS Statis (EMV)'),
    el('div', { style: 'margin-bottom:8px' }, uploadBtn, qrisFile, decodeStatus),
    qrisStatic,
    el('div', { class: 'hint', style: 'margin-top:4px' }, 'Upload gambar QRIS untuk konversi otomatis ke string, atau tempel manual. Sistem mengubahnya jadi QRIS dinamis sesuai nominal.')
  );

  const form = el('form', {},
    field('Nama Merchant', merchantName, 'Tampil pada referensi pembayaran.'),
    qrisField,
    field('PayHook Token', webhookToken, 'Token rahasia yang dikirim aplikasi PayHook saat verifikasi pembayaran.'),
    field('Maks Nominal Unik (Rp)', uniqueMax, 'Selisih rupiah unik untuk membedakan order bersamaan (default 50).'),
    el('button', { class: 'btn primary', type: 'submit' }, 'Simpan Konfigurasi')
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = {
      merchant_name: merchantName.value.trim() || 'Cahaya Store',
      qris_static: qrisStatic.value.trim(),
      webhook_token: webhookToken.value.trim(),
      unique_max: Math.max(1, Math.min(200, Number(uniqueMax.value) || 50)),
    };
    if (!value.qris_static) {
      toast('QRIS statis wajib diisi.', 'err');
      return;
    }
    try {
      await api('/api/admin/settings/' + KEY, {
        method: 'PUT',
        body: JSON.stringify({ value, secret: true }),
      });
      toast('Konfigurasi pembayaran tersimpan.', 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  const guide = el('div', {},
    el('ol', { style: 'margin:0;padding-left:18px;color:var(--color-text-secondary);font-size:14px;line-height:1.9' },
      el('li', {}, 'Install aplikasi PayHook di HP merchant (yang menerima notifikasi pembayaran).'),
      el('li', {}, 'Set URL webhook PayHook ke:'),
      el('li', { style: 'list-style:none;margin:6px 0' },
        el('code', { style: 'display:block;padding:10px 12px;background:var(--color-surface-soft);border:1px solid var(--color-border);border-radius:8px;word-break:break-all' }, WEBHOOK_URL)),
      el('li', {}, 'Auth: pilih Bearer Token, atau header X-API-Key / x-payhook-token — isi dengan "PayHook Token" di atas.'),
      el('li', {}, 'PayHook mengirim nominal pembayaran (JSON); sistem mencocokkan order pending berdasarkan nominal unik lalu mengirim produk otomatis.')
    )
  );

  const wrap = el('div', {},
    el('div', { class: 'page-head' },
      el('div', {},
        el('h1', {}, 'Pembayaran'),
        el('div', { class: 'sub' }, 'Konfigurasi MyQRIS + verifikasi otomatis via PayHook.')
      )
    ),
    collapseCard('Konfigurasi MyQRIS', form, { open: false, subtitle: 'QRIS, PayHook token, nominal unik' }),
    collapseCard('Cara pakai PayHook', guide, { open: false, subtitle: 'Panduan setup webhook' })
  );
  return shell(wrap);
}
