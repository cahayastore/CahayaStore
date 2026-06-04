/* Step 3 — Harga & status aktif */
import { el, formatIDR } from '../../dom.js';

export function renderStepPricing(ctx) {
  const { form, setField } = ctx;

  const priceInput = el('input', {
    name: 'price',
    type: 'number',
    min: '0',
    step: '1000',
    value: form.price,
    placeholder: '0',
    oninput: (e) => {
      setField('price', Number(e.target.value) || 0);
      preview.textContent = formatIDR(form.price);
    }
  });

  const preview = el('div', {
    style: 'font-family:var(--font-h);font-weight:800;font-size:22px;letter-spacing:-0.02em;color:var(--color-primary);margin-top:4px'
  }, formatIDR(form.price));

  const activeCheck = el('input', {
    type: 'checkbox',
    name: 'is_active',
    checked: !!form.is_active,
    onchange: (e) => setField('is_active', e.target.checked)
  });

  return el('div', { class: 'wz-step-pane' },
    el('h3', {}, 'Harga & status'),
    el('p', { class: 'hint' }, 'Harga ditampilkan di storefront. Bisa diubah kapan saja.'),

    el('div', { class: 'field' },
      el('label', {}, 'Harga Jual (Rp) *'),
      priceInput,
      preview
    ),

    el('div', { class: 'field', style: 'margin-top:18px' },
      el('label', {
        style: 'display:flex;align-items:center;gap:10px;font-size:var(--fs-lg);font-weight:600;color:var(--color-text-primary);cursor:pointer'
      },
        activeCheck,
        el('span', {}, 'Aktifkan produk di storefront'),
      ),
      el('div', { class: 'hint', style: 'margin-top:4px;margin-left:24px' },
        'Jika dinonaktifkan, produk tetap tersimpan tapi tidak tampil di toko.')
    )
  );
}

export function validateStepPricing(form) {
  const p = Number(form.price);
  if (!Number.isFinite(p) || p < 0) return 'Harga harus angka >= 0.';
  if (p === 0) return 'Harga tidak boleh 0.';
  return null;
}
