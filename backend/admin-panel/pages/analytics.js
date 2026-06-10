/* Admin page: Analitik */
import { el, $, formatIDR, formatDate, alertBox } from '../dom.js';
import { api } from '../api.js';
import { shell } from '../shell.js';

function kpiCard(label, value, accent) {
  return el('div', { class: 'card' },
    el('div', { class: 'kpi-label' }, label),
    el('div', { class: 'kpi-value', style: accent ? `color:${accent}` : '' }, value)
  );
}

function buildTrendChart(trend) {
  const max = Math.max(1, ...trend.map((d) => Number(d.revenue)));
  const bars = trend.map((d) => {
    const rev = Number(d.revenue);
    const h = Math.round((rev / max) * 100);
    const label = d.day.slice(5); // MM-DD
    return el('div', { class: 'an-bar-col', title: `${d.day}: ${formatIDR(rev)} (${d.orders} order)` },
      el('div', { class: 'an-bar-track' },
        el('div', { class: 'an-bar-fill', style: `height:${h}%` })
      ),
      el('div', { class: 'an-bar-label' }, label)
    );
  });
  return el('div', { class: 'an-chart' }, ...bars);
}

function buildTopProducts(rows) {
  if (!rows.length) return el('p', { class: 'muted' }, 'Belum ada penjualan.');
  const max = Math.max(1, ...rows.map((r) => Number(r.revenue)));
  return el('div', { class: 'an-toplist' },
    ...rows.map((r) => el('div', { class: 'an-toprow' },
      el('div', { class: 'an-topinfo' },
        el('span', { class: 'an-topname' }, r.name || '—'),
        el('span', { class: 'an-topmeta' }, `${r.qty} terjual · ${formatIDR(Number(r.revenue))}`)
      ),
      el('div', { class: 'an-topbar' },
        el('div', { class: 'an-topbar-fill', style: `width:${Math.round((Number(r.revenue) / max) * 100)}%` })
      )
    ))
  );
}

const STATUS_LABEL = { paid: 'Lunas', pending: 'Menunggu', cancelled: 'Batal', expired: 'Kadaluarsa', refunded: 'Refund' };

function buildStatus(rows) {
  if (!rows.length) return el('p', { class: 'muted' }, 'Belum ada order.');
  return el('div', { class: 'an-status' },
    ...rows.map((r) => el('div', { class: 'an-status-item' },
      el('span', { class: 'badge ' + (r.status === 'paid' ? 'ok' : r.status === 'pending' ? 'warn' : 'danger') }, STATUS_LABEL[r.status] || r.status),
      el('span', { class: 'an-status-count' }, String(r.c))
    ))
  );
}

function buildRecent(rows) {
  if (!rows.length) return el('p', { class: 'muted' }, 'Belum ada order.');
  const t = el('table', { class: 'table' },
    el('thead', {}, el('tr', {},
      el('th', {}, 'Order'), el('th', {}, 'Email'), el('th', {}, 'Total'), el('th', {}, 'Status'), el('th', {}, 'Waktu')
    ))
  );
  const tb = el('tbody');
  rows.forEach((r) => tb.appendChild(el('tr', {},
    el('td', { style: 'font-family:ui-monospace,monospace;font-size:var(--fs-xs)' }, r.order_no),
    el('td', { class: 'muted' }, r.buyer_email || '—'),
    el('td', {}, formatIDR(Number(r.total_amount))),
    el('td', {}, el('span', { class: 'badge ' + (r.payment_status === 'paid' ? 'ok' : r.payment_status === 'pending' ? 'warn' : 'danger') }, STATUS_LABEL[r.payment_status] || r.payment_status)),
    el('td', { class: 'muted', style: 'font-size:var(--fs-xs)' }, formatDate(r.created_at))
  )));
  t.appendChild(tb);
  return t;
}

function section(title, node) {
  return el('div', { class: 'card', style: 'margin-top:16px' },
    el('h2', { style: 'margin:0 0 12px;font-size:16px' }, title),
    node
  );
}

export async function pageAnalytics() {
  const wrap = el('div', {},
    el('div', { class: 'page-head' },
      el('div', {},
        el('h1', {}, 'Analitik'),
        el('div', { class: 'sub' }, 'Ringkasan penjualan & performa toko.')
      )
    ),
    el('div', { id: 'an-body' }, el('p', { class: 'muted' }, 'Memuat data analitik…'))
  );

  try {
    const { data } = await api('/api/admin/analytics?days=14');
    const t = data.totals || {};
    const body = $('#an-body', wrap);
    body.innerHTML = '';
    body.append(
      el('div', { class: 'grid-cards' },
        kpiCard('Total Pendapatan', formatIDR(Number(t.revenue_all || 0)), 'var(--color-success)'),
        kpiCard('Pendapatan 7 Hari', formatIDR(Number(t.revenue_7d || 0))),
        kpiCard('Order Lunas', String(t.paid_orders || 0)),
        kpiCard('Order Pending', String(t.pending_orders || 0), 'var(--color-warning)')
      ),
      section(`Tren Pendapatan (${data.days} hari)`, buildTrendChart(data.trend || [])),
      el('div', { class: 'an-two-col' },
        section('Produk Terlaris', buildTopProducts(data.topProducts || [])),
        section('Status Order', buildStatus(data.statusBreakdown || []))
      ),
      section('Order Terbaru', buildRecent(data.recentOrders || []))
    );
  } catch (e) {
    $('#an-body', wrap).innerHTML = '';
    $('#an-body', wrap).appendChild(alertBox('err', e.message));
  }

  return shell(wrap);
}
