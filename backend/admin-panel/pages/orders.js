import { el, $, formatIDR, formatDate, alertBox, toast } from '../dom.js';
import { api } from '../api.js';
import { shell } from '../shell.js';

function paymentBadge(status) {
  const cls = status === 'paid' ? 'ok' : (status === 'pending' ? 'warn' : 'danger');
  return el('span', { class: 'badge ' + cls }, status);
}

function ctLabel(t) {
  const map = { code: 'Kode', credential: 'Akun', note: 'Catatan', file: 'File' };
  return map[t] || t || 'Item';
}

/* Order detail modal: info + delivered credentials + verify/resend action. */
async function openOrderDetail(order, reload) {
  const bg = el('div', { class: 'modal-bg', id: 'modal' });
  const close = () => bg.remove();
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });

  const credBox = el('div', {}, el('p', { class: 'muted' }, 'Memuat akun terkirim…'));

  const isTopup = order.order_kind === 'topup';
  const paid = String(order.payment_status).toLowerCase() === 'paid';
  const actionBtn = el('button', { class: 'btn primary', type: 'button' },
    paid ? (isTopup ? '🔄 Kreditkan Ulang Saldo' : '📨 Kirim Ulang Akun')
         : '✅ Verifikasi & Kirim');
  actionBtn.addEventListener('click', async () => {
    const msg = paid
      ? (isTopup ? 'Kreditkan ulang saldo top up ini?' : 'Kirim ulang akun ke pembeli?')
      : 'Verifikasi pembayaran ini secara manual lalu kirim akun ke pembeli?';
    if (!confirm(msg)) return;
    actionBtn.disabled = true; const prev = actionBtn.textContent; actionBtn.textContent = 'Memproses…';
    try {
      const r = await api(`/api/admin/orders/${order.id}/verify-deliver`, { method: 'POST' });
      toast((r.data && r.data.message) || 'Berhasil.', 'ok');
      close();
      reload && reload();
    } catch (e) {
      toast(e.message, 'err');
      actionBtn.disabled = false; actionBtn.textContent = prev;
    }
  });

  const modal = el('div', { class: 'modal', style: 'max-width:680px' },
    el('h2', {}, 'Order ' + order.order_no),
    el('div', { class: 'grid2', style: 'gap:10px;margin-bottom:14px' },
      el('div', {}, el('div', { class: 'muted' }, 'Pembeli'), el('b', {}, order.buyer_email || order.buyer_name || '—')),
      el('div', {}, el('div', { class: 'muted' }, 'Total'), el('b', {}, formatIDR(order.total_amount))),
      el('div', {}, el('div', { class: 'muted' }, 'Status'), paymentBadge(order.payment_status)),
      el('div', {}, el('div', { class: 'muted' }, 'Channel'), el('b', {}, order.channel || '—')),
      el('div', {}, el('div', { class: 'muted' }, 'Jenis'), el('b', {}, isTopup ? 'Top Up' : 'Produk')),
      el('div', {}, el('div', { class: 'muted' }, 'Dibuat'), el('b', {}, formatDate(order.created_at))),
    ),
    isTopup ? null : el('div', {},
      el('hr', { style: 'margin:12px 0;border:none;border-top:1px solid var(--color-border,#e5e7eb)' }),
      el('div', { style: 'font-weight:600;margin-bottom:8px' }, 'Akun / Kredensial Terkirim'),
      credBox
    ),
    el('div', { class: 'row', style: 'margin-top:16px;justify-content:space-between' },
      actionBtn,
      el('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Tutup')
    )
  );
  bg.appendChild(modal);
  document.body.appendChild(bg);

  if (!isTopup) {
    try {
      const r = await api(`/api/admin/orders/${order.id}/credentials`);
      const items = (r.data && r.data.items) || [];
      credBox.innerHTML = '';
      if (!items.length) {
        credBox.appendChild(el('p', { class: 'muted' }, 'Belum ada akun terkirim untuk order ini.'));
      } else {
        items.forEach((it, i) => {
          const copyBtn = el('button', { class: 'btn ghost small', type: 'button' }, 'Salin');
          copyBtn.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(it.content || ''); copyBtn.textContent = 'Tersalin ✓'; } catch {}
          });
          credBox.appendChild(el('div', { style: 'border:1px solid var(--color-border,#e5e7eb);border-radius:10px;padding:10px 12px;margin-bottom:8px' },
            el('div', { class: 'muted', style: 'font-size:12px;margin-bottom:4px' }, `#${i + 1} · ${ctLabel(it.content_type)} · ${it.product_name}`),
            el('pre', { style: 'white-space:pre-wrap;word-break:break-word;margin:0 0 6px;font-size:13px' }, it.content || '(kosong)'),
            copyBtn
          ));
        });
      }
    } catch (e) {
      credBox.innerHTML = '';
      credBox.appendChild(alertBox('err', e.message));
    }
  }
}

export async function pageOrders() {
  const wrap = el('div', {},
    el('div', { class: 'page-head' }, el('h1', {}, 'Pesanan')),
    el('div', { id: 'tbl' }, el('p', { class: 'muted' }, 'Memuat...'))
  );

  async function load() {
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
        const row = el('tr', { style: 'cursor:pointer', title: 'Klik untuk detail & kirim ulang' },
          el('td', {}, o.order_no),
          el('td', {}, o.buyer_name || o.buyer_email || '-'),
          el('td', { style: 'max-width:220px' }, note
            ? el('span', { class: 'order-note' }, note)
            : el('span', { class: 'muted' }, '—')),
          el('td', {}, formatIDR(o.total_amount)),
          el('td', {}, el('span', { class: 'badge' }, o.status)),
          el('td', {}, paymentBadge(o.payment_status)),
          el('td', {}, formatDate(o.created_at))
        );
        row.addEventListener('click', () => openOrderDetail(o, load));
        tb.appendChild(row);
      }
      t.appendChild(tb);
      $('#tbl', wrap).innerHTML = '';
      $('#tbl', wrap).appendChild(t);
    } catch (e) {
      $('#tbl', wrap).innerHTML = '';
      $('#tbl', wrap).appendChild(alertBox('err', e.message));
    }
  }

  await load();
  return shell(wrap);
}
