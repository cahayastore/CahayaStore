import { el, $, formatIDR, formatDate, alertBox } from '../dom.js';
import { api } from '../api.js';
import { shell } from '../shell.js';

function paymentBadge(status) {
  const cls = status === 'paid' ? 'ok' : (status === 'pending' ? 'warn' : 'danger');
  return el('span', { class: 'badge ' + cls }, status);
}

export async function pageOrders() {
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
        el('th', {}, 'Catatan'),
        el('th', {}, 'Total'),
        el('th', {}, 'Status'),
        el('th', {}, 'Bayar'),
        el('th', {}, 'Dibuat')
      ))
    );
    const tb = el('tbody');
    if (!data.length) {
      tb.appendChild(el('tr', {}, el('td', { colspan: '7', class: 'muted', style: 'text-align:center;padding:24px' }, 'Belum ada pesanan.')));
    }
    for (const o of data) {
      const note = (o.customer_note || '').trim();
      tb.appendChild(el('tr', {},
        el('td', {}, o.order_no),
        el('td', {}, o.buyer_name || o.buyer_email || '-'),
        el('td', { style: 'max-width:220px', title: note }, note
          ? el('span', { class: 'order-note' }, note)
          : el('span', { class: 'muted' }, '—')),
        el('td', {}, formatIDR(o.total_amount)),
        el('td', {}, el('span', { class: 'badge' }, o.status)),
        el('td', {}, paymentBadge(o.payment_status)),
        el('td', {}, formatDate(o.created_at))
      ));
    }
    t.appendChild(tb);
    $('#tbl', wrap).innerHTML = '';
    $('#tbl', wrap).appendChild(t);
  } catch (e) {
    $('#tbl', wrap).innerHTML = '';
    $('#tbl', wrap).appendChild(alertBox('err', e.message));
  }
  return shell(wrap);
}
