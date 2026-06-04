import { el, $, formatIDR, alertBox } from '../dom.js';
import { api } from '../api.js';
import { shell } from '../shell.js';

function kpiCard(label, value) {
  return el('div', { class: 'card' },
    el('div', { class: 'kpi-label' }, label),
    el('div', { class: 'kpi-value' }, value)
  );
}

export async function pageDashboard() {
  const wrap = el('div', {},
    el('div', { class: 'page-head' }, el('h1', {}, 'Dashboard')),
    el('div', { class: 'grid-cards', id: 'kpis' }, el('p', { class: 'muted' }, 'Memuat...'))
  );
  try {
    const { data } = await api('/api/admin/dashboard');
    const target = $('#kpis', wrap);
    target.innerHTML = '';
    target.append(
      kpiCard('Produk Aktif', String(data.products)),
      kpiCard('Total Order', String(data.orders)),
      kpiCard('Pendapatan 24 jam', formatIDR(data.paid_24h)),
      kpiCard('Pengaturan', String(data.settings))
    );
  } catch (e) {
    $('#kpis', wrap).innerHTML = '';
    $('#kpis', wrap).appendChild(alertBox('err', e.message));
  }
  return shell(wrap);
}
