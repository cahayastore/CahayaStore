/* Voucher management page — admin creates codes users redeem for balance. */
import { el, $, alertBox, toast, formatIDR, formatDate } from '../dom.js';
import { api } from '../api.js';
import { shell } from '../shell.js';

function voucherRow(v, onChange) {
  const used = `${v.used_count}/${v.max_uses}`;
  const status = v.is_active ? el('span', { class: 'badge ok' }, 'Aktif') : el('span', { class: 'badge' }, 'Nonaktif');
  const exp = v.expires_at ? formatDate(v.expires_at) : '—';

  const toggleBtn = el('button', { class: 'btn ghost small', type: 'button' }, v.is_active ? 'Nonaktifkan' : 'Aktifkan');
  toggleBtn.addEventListener('click', async () => {
    try { await api(`/api/admin/vouchers/${v.id}/active`, { method: 'PUT', body: JSON.stringify({ active: !v.is_active }) }); toast('Diperbarui.', 'ok'); onChange(); }
    catch (e) { toast(e.message, 'err'); }
  });
  const delBtn = el('button', { class: 'btn ghost small', type: 'button', style: 'color:var(--color-error)' }, 'Hapus');
  delBtn.addEventListener('click', async () => {
    if (!confirm(`Hapus voucher ${v.code}?`)) return;
    try { await api(`/api/admin/vouchers/${v.id}`, { method: 'DELETE' }); toast('Dihapus.', 'ok'); onChange(); }
    catch (e) { toast(e.message, 'err'); }
  });

  return el('tr', {},
    el('td', {}, el('code', {}, v.code)),
    el('td', {}, formatIDR(v.amount)),
    el('td', {}, used),
    el('td', {}, String(v.per_user_limit)),
    el('td', {}, exp),
    el('td', {}, status),
    el('td', { style: 'white-space:nowrap' }, toggleBtn, ' ', delBtn)
  );
}

function buildCreateForm(onCreated) {
  const form = el('form', { class: 'card', style: 'padding:16px;margin-bottom:18px' },
    el('h3', { style: 'margin-top:0' }, 'Buat Voucher Baru'),
    el('div', { class: 'grid2' },
      el('div', { class: 'field' }, el('label', {}, 'Kode'), el('input', { name: 'code', placeholder: 'HEMAT50', required: 'true' })),
      el('div', { class: 'field' }, el('label', {}, 'Nominal (Rp)'), el('input', { name: 'amount', type: 'number', min: '1', placeholder: '50000', required: 'true' }))
    ),
    el('div', { class: 'grid2' },
      el('div', { class: 'field' }, el('label', {}, 'Maks. Pemakaian Total'), el('input', { name: 'maxUses', type: 'number', min: '1', value: '1' })),
      el('div', { class: 'field' }, el('label', {}, 'Maks. per User'), el('input', { name: 'perUserLimit', type: 'number', min: '1', value: '1' }))
    ),
    el('div', { class: 'field' }, el('label', {}, 'Kedaluwarsa (opsional)'), el('input', { name: 'expiresAt', type: 'datetime-local' })),
    el('div', { class: 'field' }, el('label', {}, 'Catatan (opsional)'), el('input', { name: 'note', placeholder: 'Promo akhir bulan' })),
    el('button', { class: 'btn primary', type: 'submit' }, 'Buat Voucher')
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const expRaw = fd.get('expiresAt');
    const payload = {
      code: String(fd.get('code') || '').trim(),
      amount: Number(fd.get('amount')),
      maxUses: Number(fd.get('maxUses')) || 1,
      perUserLimit: Number(fd.get('perUserLimit')) || 1,
      expiresAt: expRaw ? new Date(expRaw).toISOString() : null,
      note: String(fd.get('note') || '').trim() || null,
    };
    if (!payload.code || !(payload.amount > 0)) { toast('Kode & nominal wajib diisi.', 'err'); return; }
    try {
      await api('/api/admin/vouchers', { method: 'POST', body: JSON.stringify(payload) });
      toast('Voucher dibuat.', 'ok');
      form.reset();
      onCreated();
    } catch (err) { toast(err.message, 'err'); }
  });
  return form;
}

export async function pageVouchers() {
  const wrap = el('div', {},
    el('div', { class: 'page-head' }, el('h1', {}, 'Voucher')),
    el('div', { id: 'vc' }, el('p', { class: 'muted' }, 'Memuat...'))
  );

  async function load() {
    try {
      const { data } = await api('/api/admin/vouchers');
      const container = $('#vc', wrap);
      container.innerHTML = '';
      container.appendChild(buildCreateForm(load));

      const t = el('table', { class: 'table' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Kode'), el('th', {}, 'Nominal'), el('th', {}, 'Terpakai'),
          el('th', {}, 'Per User'), el('th', {}, 'Kedaluwarsa'), el('th', {}, 'Status'), el('th', {}, 'Aksi')
        ))
      );
      const tb = el('tbody');
      if (!data.length) tb.appendChild(el('tr', {}, el('td', { colspan: '7', class: 'muted', style: 'text-align:center;padding:24px' }, 'Belum ada voucher.')));
      for (const v of data) tb.appendChild(voucherRow(v, load));
      t.appendChild(tb);
      container.appendChild(t);
    } catch (e) {
      const container = $('#vc', wrap);
      container.innerHTML = '';
      container.appendChild(alertBox('err', e.message));
    }
  }

  await load();
  return shell(wrap);
}
