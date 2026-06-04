/* Step 1 — Tipe produk + jenis stok */
import { el } from '../../dom.js';
import { PRODUCT_TYPES, STOCK_TYPES } from './constants.js';

function choiceCard(opt, selected, onPick) {
  const cls = 'wz-choice' + (selected ? ' selected' : '');
  return el('button', { type: 'button', class: cls, onclick: onPick },
    el('div', { class: 'check' }, '✓'),
    el('div', { class: 'ico' }, opt.icon || '•'),
    el('div', { class: 'name' }, opt.label),
    el('div', { class: 'desc' }, opt.desc)
  );
}

function smallChoice(opt, selected, onPick) {
  const cls = 'wz-choice' + (selected ? ' selected' : '');
  return el('button', { type: 'button', class: cls, onclick: onPick },
    el('div', { class: 'check' }, '✓'),
    el('div', { class: 'name' }, opt.label),
    el('div', { class: 'desc' }, opt.desc)
  );
}

export function renderStepType(ctx) {
  const { form, setField } = ctx;

  const productGrid = el('div', { class: 'wz-choice-grid' });
  PRODUCT_TYPES.forEach(opt => {
    productGrid.appendChild(
      choiceCard(opt, form.product_type === opt.value, () => {
        setField('product_type', opt.value);
        ctx.rerender();
      })
    );
  });

  const stockGrid = el('div', { class: 'wz-choice-grid' });
  STOCK_TYPES.forEach(opt => {
    stockGrid.appendChild(
      smallChoice(opt, form.stock_type === opt.value, () => {
        setField('stock_type', opt.value);
        ctx.rerender();
      })
    );
  });

  return el('div', { class: 'wz-step-pane' },
    el('h3', {}, 'Pilih tipe produk'),
    el('p', { class: 'hint' }, 'Tentukan apa yang akan dijual. Ini menentukan cara pembeli menerima pesanan.'),
    productGrid,
    el('h3', { style: 'margin-top:22px' }, 'Sumber stok'),
    el('p', { class: 'hint' }, 'Bagaimana stok produk ini diisi & dikirim ke pembeli.'),
    stockGrid
  );
}

/* Validasi sederhana step ini */
export function validateStepType(form) {
  if (!form.product_type) return 'Pilih tipe produk dulu.';
  if (!form.stock_type) return 'Pilih sumber stok dulu.';
  return null;
}
