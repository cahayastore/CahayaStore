/* User management page — search users, view balance/spend/transactions,
   manually adjust balance, and ban/unban. */
import { el, $, alertBox, toast, formatIDR, formatDate } from '../dom.js';
import { api } from '../api.js';
import { shell } from '../shell.js';

function userName(u) {
  return u.telegram_username ? '@' + u.telegram_username
    : (u.name || (u.telegram_id ? 'ID ' + u.telegram_id : '—'));
}

function txTypeLabel(t) {
  const map = { topup: 'Top Up', purchase: 'Pembelian', refund: 'Refund', referral_bonus: 'Bonus Referral', adjustment: 'Penyesuaian', voucher: 'Voucher' };
  return map[t] || t;
}

async function openUserDetail(id, reloadList) {
  let res;
  try { res = await api(`/api/admin/users/${id}`); }
  catch (e) { toast(e.message, 'err'); return; }
  const d = res.data;
  const u = d.user;

  const bg = el('div', { class: 'modal-bg', id: 'modal' });
  const close = () => bg.remove();
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });

  const balanceEl = el('b', {}, formatIDR(u.balance));

  // Manual balance adjust controls.
  const amtInput = el('input', { type: 'number', placeholder: 'cth: 50000 atau -10000', style: 'flex:1;min-width:140px' });
  const noteInput = el('input', { placeholder: 'Catatan (opsional)', style: 'flex:1;min-width:140px' });
  const applyBtn = el('button', { class: 'btn primary small', type: 'button' }, 'Terapkan');
  applyBtn.addEventListener('click', async () => {
    const amount = Number(amtInput.value);
    if (!amount) { toast('Isi nominal (boleh negatif).', 'err'); return; }
    applyBtn.disabled = true;
    try {
      const r = await api(`/api/admin/users/${id}/balance`, { method: 'POST', body: JSON.stringify({ amount, note: noteInput.value }) });
      balanceEl.textContent = formatIDR(r.data.balance);
      amtInput.value = ''; noteInput.value = '';
      toast('Saldo diperbarui.', 'ok');
      reloadList && reloadList();
    } catch (e) { toast(e.message, 'err'); }
    applyBtn.disabled = false;
  });

  // Ban / unban.
  const banBtn = el('button', { class: 'btn ghost small', type: 'button', style: u.is_active ? 'color:var(--color-error)' : '' },
    u.is_active ? '🚫 Blokir User' : '✅ Aktifkan User');
  banBtn.addEventListener('click', async () => {
    const next = !u.is_active;
    if (!confirm(next ? 'Aktifkan user ini?' : 'Blokir user ini?')) return;
    try {
      await api(`/api/admin/users/${id}/active`, { method: 'PUT', body: JSON.stringify({ active: next }) });
      u.is_active = next;
      banBtn.textContent = next ? '🚫 Blokir User' : '✅ Aktifkan User';
      banBtn.style.color = next ? 'var(--color-error)' : '';
      toast(next ? 'User diaktifkan.' : 'User diblokir.', 'ok');
      reloadList && reloadList();
    } catch (e) { toast(e.message, 'err'); }
  });

  // Transactions table.
  const txBody = el('tbody');
  if (!d.transactions.length) {
    txBody.appendChild(el('tr', {}, el('td', { colspan: '4', class: 'muted', style: 'text-align:center;padding:18px' }, 'Belum ada transaksi.')));
  } else {
    for (const t of d.transactions) {
      const amt = Number(t.amount);
      txBody.appendChild(el('tr', {},
        el('td', {}, formatDate(t.created_at)),
        el('td', {}, txTypeLabel(t.type)),
        el('td', { style: 'color:' + (amt >= 0 ? 'var(--color-success,#16a34a)' : 'var(--color-error,#dc2626)') }, (amt >= 0 ? '+' : '') + formatIDR(amt)),
        el('td', {}, t.note || '—')
      ));
    }
  }

  const modal = el('div', { class: 'modal', style: 'max-width:680px' },
    el('h2', {}, userName(u)),
    el('div', { class: 'grid2', style: 'gap:10px;margin-bottom:14px' },
      el('div', {}, el('div', { class: 'muted' }, 'Saldo'), balanceEl),
      el('div', {}, el('div', { class: 'muted' }, 'Total Belanja'), el('b', {}, formatIDR(d.spend) + ` (${d.spendOrders} order)`)),
      el('div', {}, el('div', { class: 'muted' }, 'Total Top Up'), el('b', {}, formatIDR(d.topupTotal))),
      el('div', {}, el('div', { class: 'muted' }, 'Status'), el('b', {}, u.is_active ? '✅ Aktif' : '🚫 Diblokir')),
    ),
    el('div', {}, el('div', { class: 'muted' }, u.email || '—'),
      u.telegram_id ? el('div', { class: 'muted' }, 'Telegram ID: ' + u.telegram_id) : null),
    el('hr', { style: 'margin:14px 0;border:none;border-top:1px solid var(--color-border,#e5e7eb)' }),
    el('div', { style: 'font-weight:600;margin-bottom:8px' }, 'Isi / Kurangi Saldo'),
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, amtInput, noteInput, applyBtn),
    el('div', { class: 'hint', style: 'margin-top:6px' }, 'Nominal positif menambah saldo, negatif mengurangi.'),
    el('hr', { style: 'margin:14px 0;border:none;border-top:1px solid var(--color-border,#e5e7eb)' }),
    el('div', { style: 'font-weight:600;margin-bottom:8px' }, 'Riwayat Transaksi'),
    el('div', { style: 'max-height:260px;overflow:auto' },
      el('table', { class: 'table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Waktu'), el('th', {}, 'Tipe'), el('th', {}, 'Jumlah'), el('th', {}, 'Catatan'))),
        txBody
      )
    ),
    el('div', { class: 'row', style: 'margin-top:14px;justify-content:space-between' },
      banBtn,
      el('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Tutup')
    )
  );
  bg.appendChild(modal);
  document.body.appendChild(bg);
}

export async function pageUsers() {
  const wrap = el('div', {},
    el('div', { class: 'page-head' }, el('h1', {}, 'User')),
    el('div', { id: 'us' }, el('p', { class: 'muted' }, 'Memuat...'))
  );

  const search = el('input', { type: 'search', placeholder: 'Cari nama / email / @username / telegram id…', style: 'width:100%;max-width:420px' });
  let timer = null;

  async function load() {
    const container = $('#us', wrap);
    try {
      const q = search.value.trim();
      const r = await api(`/api/admin/users?q=${encodeURIComponent(q)}&limit=50`);
      const rows = r.data;

      const tb = el('tbody');
      if (!rows.length) {
        tb.appendChild(el('tr', {}, el('td', { colspan: '5', class: 'muted', style: 'text-align:center;padding:24px' }, 'Tidak ada user.')));
      } else {
        for (const u of rows) {
          const openBtn = el('button', { class: 'btn ghost small', type: 'button' }, 'Detail');
          openBtn.addEventListener('click', () => openUserDetail(u.id, load));
          tb.appendChild(el('tr', {},
            el('td', {}, userName(u) + (u.is_active ? '' : ' 🚫')),
            el('td', {}, u.email || '—'),
            el('td', {}, formatIDR(u.balance)),
            el('td', {}, formatIDR(u.spend)),
            el('td', { style: 'white-space:nowrap' }, openBtn)
          ));
        }
      }
      const table = el('table', { class: 'table' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'User'), el('th', {}, 'Email'), el('th', {}, 'Saldo'), el('th', {}, 'Total Belanja'), el('th', {}, 'Aksi')
        )),
        tb
      );

      container.innerHTML = '';
      container.appendChild(el('div', { style: 'margin-bottom:14px' }, search));
      container.appendChild(el('p', { class: 'muted', style: 'margin:0 0 10px' }, `${rows.length} user${r.total > rows.length ? ' (dari ' + r.total + ')' : ''}`));
      container.appendChild(table);
    } catch (e) {
      container.innerHTML = '';
      container.appendChild(alertBox('err', e.message));
    }
  }

  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 350); });
  await load();
  return shell(wrap);
}
