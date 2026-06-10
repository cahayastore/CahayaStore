import { el, alertBox, toast, collapseCard } from '../dom.js';
import { api } from '../api.js';
import { shell } from '../shell.js';
import { buildChangePasswordCard } from './settings/change-password.js';

const SECTIONS = [
  {
    key: 'telegram.bot', secret: true, title: 'Telegram Bot',
    note: 'Bot token & secret webhook (disimpan terenkripsi). Webhook URL: https://api.cahayastore.me/api/webhooks/telegram/main',
    fields: [
      { name: 'token', label: 'Bot Token', type: 'password' },
      { name: 'username', label: 'Bot Username (opsional)' },
      { name: 'webhook_secret', label: 'Webhook Secret', type: 'password' }
    ]
  },
  {
    key: 'store.profile', secret: false, title: 'Profil Toko',
    fields: [
      { name: 'name', label: 'Nama Toko' },
      { name: 'description', label: 'Deskripsi', type: 'textarea' },
      { name: 'telegram_link', label: 'Link Telegram' },
      { name: 'support_email', label: 'Email Support' }
    ]
  },
  {
    key: 'order.policy', secret: false, title: 'Kebijakan Order',
    note: 'Batas waktu pembayaran. Order yang belum dibayar melewati batas ini otomatis kedaluwarsa dan stok dilepas kembali.',
    fields: [
      { name: 'expiry_minutes', label: 'Batas Waktu Pembayaran (menit)', type: 'number', min: 1, max: 1440, default: 30,
        hint: 'Antara 1–1440 menit (maks 24 jam). Default 30 menit.' }
    ]
  }
];

function inputField(field, value) {
  const attrs = { name: field.name, autocomplete: field.secret ? 'off' : 'on' };
  if (field.type === 'textarea') {
    return el('div', { class: 'field' }, el('label', {}, field.label),
      el('textarea', { ...attrs, rows: '2' }, value || ''));
  }
  if (field.type === 'number') {
    if (field.min != null) attrs.min = String(field.min);
    if (field.max != null) attrs.max = String(field.max);
    attrs.step = '1';
  }
  const shown = value != null && value !== '' ? value : (field.default != null ? field.default : '');
  const node = el('div', { class: 'field' }, el('label', {}, field.label),
    el('input', { ...attrs, type: field.type || 'text', value: shown }));
  if (field.hint) node.appendChild(el('small', { class: 'field-hint' }, field.hint));
  return node;
}

function buildSection(section) {
  const status = alertBox('', '');
  status.style.display = 'none';
  const form = el('form', {});
  for (const f of section.fields) form.appendChild(inputField(f, ''));
  form.appendChild(status);
  form.appendChild(el('button', { class: 'btn primary', type: 'submit' }, 'Simpan'));

  api('/api/admin/settings/' + section.key)
    .then(r => {
      if (!r.value) return;
      for (const f of section.fields) {
        const input = form.querySelector(`[name="${f.name}"]`);
        if (input && r.value[f.name] != null) input.value = r.value[f.name];
      }
      if (section.secret) {
        status.textContent = 'Sudah ada nilai tersimpan (disensor untuk tampilan).';
        status.className = 'alert';
        status.style.display = '';
      }
    })
    .catch(() => { /* unset is normal */ });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const value = {};
    for (const f of section.fields) {
      const raw = fd.get(f.name);
      if (f.type === 'number') {
        let n = Number(raw);
        if (!Number.isFinite(n)) n = f.default != null ? Number(f.default) : null;
        if (n != null) {
          if (f.min != null) n = Math.max(f.min, n);
          if (f.max != null) n = Math.min(f.max, n);
          n = Math.round(n);
        }
        value[f.name] = n;
      } else {
        value[f.name] = raw || null;
      }
    }
    try {
      await api('/api/admin/settings/' + section.key, {
        method: 'PUT',
        body: JSON.stringify({ value, secret: section.secret })
      });
      toast(`${section.title} tersimpan.`, 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  return collapseCard(section.title, form, { open: false, subtitle: section.note || '' });
}

export async function pageSettings() {
  const wrap = el('div', {},
    el('div', { class: 'page-head' },
      el('div', {},
        el('h1', {}, 'Pengaturan'),
        el('div', { class: 'sub' }, 'Konfigurasi toko, payment, bot, dan keamanan akun.')
      )
    )
  );
  // Security card di atas (paling penting)
  wrap.appendChild(collapseCard('Ubah Password', buildChangePasswordCard(), { open: false, subtitle: 'Keamanan akun admin' }));
  // Konfigurasi lain
  for (const s of SECTIONS) wrap.appendChild(buildSection(s));
  return shell(wrap);
}
