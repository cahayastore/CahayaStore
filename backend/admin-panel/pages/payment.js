/* Admin page: Pembayaran (MyQRIS + PayHook) */
import { el, alertBox } from '../dom.js';
import { api } from '../api.js';
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

export async function pagePayment() {
  const status = alertBox('', '');
  status.style.display = 'none';

  const merchantName = el('input', { name: 'merchant_name', placeholder: 'Cahaya Store' });
  const qrisStatic = el('textarea', { name: 'qris_static', rows: '4', placeholder: '00020101021126...QRIS string dari merchant' });
  const webhookToken = el('input', { name: 'webhook_token', type: 'text', placeholder: 'token rahasia untuk PayHook' });
  const uniqueMax = el('input', { name: 'unique_max', type: 'number', min: '1', max: '200', value: '50' });

  // Load existing
  api('/api/admin/settings/' + KEY).then((r) => {
    const v = r.value || {};
    if (v.merchant_name) merchantName.value = v.merchant_name;
    if (v.qris_static) qrisStatic.value = v.qris_static;
    if (v.webhook_token) webhookToken.value = v.webhook_token;
    if (v.unique_max) uniqueMax.value = v.unique_max;
  }).catch(() => { /* unset is fine */ });

  const form = el('form', {},
    field('Nama Merchant', merchantName, 'Tampil pada referensi pembayaran.'),
    field('QRIS Statis (EMV)', qrisStatic, 'Tempel string QRIS statis dari merchant. Sistem mengubahnya jadi QRIS dinamis sesuai nominal otomatis.'),
    field('PayHook Token', webhookToken, 'Token rahasia yang dikirim aplikasi PayHook saat verifikasi pembayaran.'),
    field('Maks Nominal Unik (Rp)', uniqueMax, 'Selisih rupiah unik untuk membedakan order bersamaan (default 50).'),
    el('button', { class: 'btn primary', type: 'submit' }, 'Simpan Konfigurasi'),
    status
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
      status.textContent = 'QRIS statis wajib diisi.';
      status.className = 'alert err'; status.style.display = '';
      return;
    }
    try {
      await api('/api/admin/settings/' + KEY, {
        method: 'PUT',
        body: JSON.stringify({ value, secret: true }),
      });
      status.textContent = 'Konfigurasi pembayaran tersimpan.';
      status.className = 'alert ok'; status.style.display = '';
    } catch (err) {
      status.textContent = err.message;
      status.className = 'alert err'; status.style.display = '';
    }
  });

  const guide = el('div', { class: 'card', style: 'margin-top:18px' },
    el('h2', { style: 'margin:0 0 10px;font-size:16px' }, 'Cara pakai PayHook'),
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
    el('div', { class: 'card' }, form),
    guide
  );
  return shell(wrap);
}
