import { el, $, formatIDR, showModal, closeModal, alertBox } from '../dom.js';
import { api } from '../api.js';
import { shell } from '../shell.js';

const PRODUCT_TYPES = ['file', 'account', 'voucher'];

function productForm(p, cats) {
  const typeSelect = el('select', { name: 'product_type', required: true });
  for (const opt of PRODUCT_TYPES) {
    const o = el('option', { value: opt }, opt);
    if (p?.product_type === opt) o.selected = true;
    typeSelect.appendChild(o);
  }

  const catSelect = el('select', { name: 'category_id' },
    el('option', { value: '' }, '— pilih —')
  );
  for (const c of cats) {
    const o = el('option', { value: c.id }, c.name);
    if (p?.category_id === c.id) o.selected = true;
    catSelect.appendChild(o);
  }

  return el('form', {},
    el('div', { class: 'field' }, el('label', {}, 'Nama'),
      el('input', { name: 'name', value: p?.name || '', required: true })),
    el('div', { class: 'field' }, el('label', {}, 'Slug'),
      el('input', { name: 'slug', value: p?.slug || '', required: true })),
    el('div', { class: 'field' }, el('label', {}, 'Deskripsi'),
      el('textarea', { name: 'description', rows: '3' }, p?.description || '')),
    el('div', { class: 'field' }, el('label', {}, 'Harga'),
      el('input', { name: 'price', type: 'number', value: p?.price || 0, required: true })),
    el('div', { class: 'field' }, el('label', {}, 'Tipe Produk'), typeSelect),
    el('div', { class: 'field' }, el('label', {}, 'Kategori'), catSelect),
    el('div', { class: 'field' }, el('label', {},
      el('input', { type: 'checkbox', name: 'is_active', checked: p?.is_active !== false }),
      ' Aktif'))
  );
}

async function openProductForm(p, onReload) {
  const { data: cats } = await api('/api/admin/categories');
  const f = productForm(p, cats);
  showModal(p ? 'Edit Produk' : 'Tambah Produk', f, async () => {
    const fd = new FormData(f);
    const body = {
      name: fd.get('name'),
      slug: fd.get('slug'),
      description: fd.get('description') || null,
      price: Number(fd.get('price')),
      product_type: fd.get('product_type'),
      category_id: fd.get('category_id') || null,
      is_active: !!fd.get('is_active')
    };
    if (p) await api('/api/admin/products/' + p.id, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/admin/products', { method: 'POST', body: JSON.stringify(body) });
    closeModal();
    onReload();
  });
}

function productRow(p, catName, onReload) {
  return el('tr', {},
    el('td', {}, p.name),
    el('td', {}, catName),
    el('td', {}, p.product_type),
    el('td', {}, formatIDR(p.price)),
    el('td', {}, String(p.stock_count || 0)),
    el('td', {}, el('span', { class: 'badge ' + (p.is_active ? 'ok' : 'danger') }, p.is_active ? 'Aktif' : 'Nonaktif')),
    el('td', {}, el('div', { class: 'row-actions' },
      el('button', { class: 'btn ghost small', onclick: () => openProductForm(p, onReload) }, 'Edit'),
      el('button', {
        class: 'btn danger small',
        onclick: async () => {
          if (!confirm('Hapus produk ini?')) return;
          await api('/api/admin/products/' + p.id, { method: 'DELETE' });
          onReload();
        }
      }, 'Hapus')
    ))
  );
}

export async function pageProducts() {
  const wrap = el('div', {},
    el('div', { class: 'page-head' },
      el('h1', {}, 'Produk'),
      el('button', { class: 'btn primary', onclick: () => openProductForm(null, reload) }, '+ Tambah Produk')
    ),
    el('div', { id: 'tbl' }, el('p', { class: 'muted' }, 'Memuat...'))
  );

  async function reload() {
    try {
      const [{ data: products }, { data: cats }] = await Promise.all([
        api('/api/admin/products'),
        api('/api/admin/categories')
      ]);
      const catMap = new Map(cats.map(c => [c.id, c.name]));
      const t = el('table', { class: 'table' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Nama'),
          el('th', {}, 'Kategori'),
          el('th', {}, 'Tipe'),
          el('th', {}, 'Harga'),
          el('th', {}, 'Stok'),
          el('th', {}, 'Status'),
          el('th', {}, '')
        ))
      );
      const tb = el('tbody');
      for (const p of products) {
        tb.appendChild(productRow(p, p.category_id ? (catMap.get(p.category_id) || '-') : '-', reload));
      }
      t.appendChild(tb);
      $('#tbl', wrap).innerHTML = '';
      $('#tbl', wrap).appendChild(t);
    } catch (e) {
      $('#tbl', wrap).innerHTML = '';
      $('#tbl', wrap).appendChild(alertBox('err', e.message));
    }
  }

  reload();
  return shell(wrap);
}
