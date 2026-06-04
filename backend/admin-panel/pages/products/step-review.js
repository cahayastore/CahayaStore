/* Step 4 — Review & submit */
import { el, formatIDR } from '../../dom.js';
import { PRODUCT_TYPES, STOCK_TYPES } from './constants.js';

function lookup(arr, val) {
  return (arr.find(x => x.value === val) || {}).label || val || '—';
}

export function renderStepReview(ctx) {
  const { form, categories = [], isEdit } = ctx;
  const catName = form.category_id
    ? ((categories.find(c => c.id === form.category_id) || {}).name || '—')
    : '— Tanpa kategori —';

  const dl = el('dl', {});
  const row = (k, v) => {
    dl.appendChild(el('dt', {}, k));
    dl.appendChild(el('dd', {}, v));
  };
  row('Tipe Produk', lookup(PRODUCT_TYPES, form.product_type));
  row('Sumber Stok', lookup(STOCK_TYPES, form.stock_type));
  row('Nama', form.name || '—');
  row('Slug', form.slug || '—');
  row('Kategori', catName);
  row('Harga', formatIDR(form.price));
  row('Status', form.is_active ? 'Aktif' : 'Nonaktif');
  if (form.description) row('Deskripsi', form.description);

  return el('div', { class: 'wz-step-pane' },
    el('h3', {}, isEdit ? 'Periksa perubahan' : 'Periksa kembali'),
    el('p', { class: 'hint' },
      isEdit
        ? 'Cek detail sebelum menyimpan perubahan.'
        : 'Cek detail sebelum produk dibuat.'),
    el('div', { class: 'wz-summary' }, dl)
  );
}

export function validateStepReview(_form) {
  return null;
}
