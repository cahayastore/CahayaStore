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

/* Build a CSV string from redemption rows and trigger a browser download. */
function downloadRedemptionsCsv(rows) {
  const esc = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = ['Waktu', 'Kode', 'User', 'Telegram ID', 'Nominal'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const who = r.telegram_username ? '@' + r.telegram_username : (r.user_name || '');
    lines.push([
      esc(new Date(r.created_at).toISOString()),
      esc(r.code),
      esc(who),
      esc(r.telegram_id || ''),
      esc(r.amount),
    ].join(','));
  }
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `voucher-redemptions-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* Redemption history report (who redeemed which voucher, when).
   Supports a free-text filter (code/user) and CSV export of the filtered view. */
async function buildRedemptionsReport() {
  const section = el('div', { style: 'margin-top:26px' },
    el('h3', { style: 'margin:0 0 10px' }, 'Riwayat Pemakaian Voucher')
  );
  try {
    const { data } = await api('/api/admin/vouchers/redemptions');

    const search = el('input', { type: 'search', placeholder: 'Cari kode / user…', style: 'flex:1;min-width:180px' });
    const csvBtn = el('button', { class: 'btn ghost small', type: 'button' }, '⬇️ Export CSV');
    const bar = el('div', { style: 'display:flex;gap:8px;align-items:center;margin:0 0 10px;flex-wrap:wrap' }, search, csvBtn);
    const summary = el('p', { class: 'muted', style: 'margin:0 0 10px' });

    const t = el('table', { class: 'table' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'Waktu'), el('th', {}, 'Kode'), el('th', {}, 'User'), el('th', {}, 'Nominal')
      ))
    );
    const tb = el('tbody');
    t.appendChild(tb);

    function whoOf(r) {
      return r.telegram_username ? '@' + r.telegram_username
        : (r.user_name || (r.telegram_id ? 'ID ' + r.telegram_id : '—'));
    }
    function filtered() {
      const q = search.value.trim().toLowerCase();
      if (!q) return data;
      return data.filter((r) =>
        String(r.code || '').toLowerCase().includes(q) ||
        whoOf(r).toLowerCase().includes(q)
      );
    }
    function render() {
      const rows = filtered();
      const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
      summary.textContent = `${rows.length} penukaran · total ${formatIDR(total)}`;
      tb.innerHTML = '';
      if (!rows.length) {
        tb.appendChild(el('tr', {}, el('td', { colspan: '4', class: 'muted', style: 'text-align:center;padding:24px' },
          data.length ? 'Tidak ada yang cocok.' : 'Belum ada penukaran.')));
        return;
      }
      for (const r of rows) {
        tb.appendChild(el('tr', {},
          el('td', {}, formatDate(r.created_at)),
          el('td', {}, el('code', {}, r.code)),
          el('td', {}, whoOf(r)),
          el('td', {}, formatIDR(r.amount))
        ));
      }
    }

    search.addEventListener('input', render);
    csvBtn.addEventListener('click', () => {
      const rows = filtered();
      if (!rows.length) { toast('Tidak ada data untuk diekspor.', 'err'); return; }
      downloadRedemptionsCsv(rows);
    });

    section.appendChild(bar);
    section.appendChild(summary);
    section.appendChild(t);
    render();
  } catch (e) {
    section.appendChild(alertBox('err', e.message));
  }
  return section;
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

      container.appendChild(await buildRedemptionsReport());
    } catch (e) {
      const container = $('#vc', wrap);
      container.innerHTML = '';
      container.appendChild(alertBox('err', e.message));
    }
  }

  await load();
  return shell(wrap);
}
