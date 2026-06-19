/* Top-up bonus page — admin sets free balance tiers granted when a user's
   top-up reaches a certain nominal. Stored in settings key topup.bonus. */
import { el, $, alertBox, toast, formatIDR } from '../dom.js';
import { api } from '../api.js';
import { shell } from '../shell.js';

const KEY = 'topup.bonus';

function tierRow(tier, onRemove) {
  const minInput = el('input', {
    type: 'number', min: '0', value: String(tier.min ?? ''), placeholder: '50000',
    class: 'tb-min', style: 'width:100%',
  });
  const bonusInput = el('input', {
    type: 'number', min: '0', value: String(tier.bonus ?? ''), placeholder: '5000',
    class: 'tb-bonus', style: 'width:100%',
  });
  const del = el('button', { class: 'btn ghost small', type: 'button', style: 'color:var(--color-error)' }, 'Hapus');
  const row = el('tr', {},
    el('td', {}, minInput),
    el('td', {}, bonusInput),
    el('td', { style: 'white-space:nowrap' }, del)
  );
  del.addEventListener('click', () => { row.remove(); onRemove && onRemove(); });
  row._read = () => ({ min: Number(minInput.value) || 0, bonus: Number(bonusInput.value) || 0 });
  return row;
}

export async function pageTopupBonus() {
  const wrap = el('div', {},
    el('div', { class: 'page-head' }, el('h1', {}, 'Bonus Top Up')),
    el('div', { id: 'tb' }, el('p', { class: 'muted' }, 'Memuat...'))
  );

  async function load() {
    const container = $('#tb', wrap);
    try {
      const r = await api(`/api/admin/settings/${encodeURIComponent(KEY)}`);
      const cfg = (r && r.value) || {};
      const enabled = !!cfg.enabled;
      const tiers = Array.isArray(cfg.tiers) ? cfg.tiers : [];

      container.innerHTML = '';

      const enableChk = el('input', { type: 'checkbox', id: 'tb-enabled' });
      if (enabled) enableChk.checked = true;
      const enableRow = el('label', { style: 'display:flex;align-items:center;gap:10px;margin:0 0 16px;cursor:pointer' },
        enableChk, el('span', {}, 'Aktifkan bonus top up')
      );

      const tbody = el('tbody');
      const table = el('table', { class: 'table' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Min. Top Up (Rp)'),
          el('th', {}, 'Bonus Saldo (Rp)'),
          el('th', {}, 'Aksi')
        )),
        tbody
      );
      const addTier = (t = {}) => tbody.appendChild(tierRow(t, () => {}));
      if (tiers.length) tiers.forEach(addTier); else addTier({});

      const addBtn = el('button', { class: 'btn ghost', type: 'button' }, '+ Tambah Tier');
      addBtn.addEventListener('click', () => addTier({}));

      const saveBtn = el('button', { class: 'btn primary', type: 'button' }, 'Simpan');
      saveBtn.addEventListener('click', async () => {
        const rows = Array.from(tbody.querySelectorAll('tr')).map((tr) => tr._read());
        const cleaned = rows
          .map((t) => ({ min: Math.max(0, Math.round(t.min)), bonus: Math.max(0, Math.round(t.bonus)) }))
          .filter((t) => t.min > 0 && t.bonus > 0)
          .sort((a, b) => a.min - b.min);
        const payload = { enabled: enableChk.checked, tiers: cleaned };
        saveBtn.disabled = true;
        try {
          await api(`/api/admin/settings/${encodeURIComponent(KEY)}`, { method: 'PUT', body: JSON.stringify({ value: payload }) });
          toast('Tersimpan.', 'ok');
          load();
        } catch (e) { toast(e.message, 'err'); saveBtn.disabled = false; }
      });

      const card = el('div', { class: 'card', style: 'padding:18px;max-width:640px' },
        el('p', { class: 'muted', style: 'margin-top:0' },
          'Beri saldo gratis otomatis saat top up user mencapai nominal tertentu. ' +
          'Jika beberapa tier cocok, tier dengan minimal tertinggi yang dipakai. Contoh: top up ≥ 50.000 → bonus 5.000.'),
        enableRow,
        table,
        el('div', { style: 'margin-top:12px;display:flex;gap:8px;flex-wrap:wrap' }, addBtn, saveBtn)
      );
      container.appendChild(card);
    } catch (e) {
      container.innerHTML = '';
      container.appendChild(alertBox('err', e.message));
    }
  }

  await load();
  return shell(wrap);
}
