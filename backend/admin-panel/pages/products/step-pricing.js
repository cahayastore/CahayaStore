/* Step 3 — Harga & status aktif */
import { el, formatIDR } from '../../dom.js';

export function renderStepPricing(ctx) {
  const { form, setField } = ctx;

  function discountText() {
    const price = Number(form.price) || 0;
    const orig = Number(form.original_price) || 0;
    if (orig > price && orig > 0) {
      const pct = Math.round((1 - price / orig) * 100);
      return `Diskon ${pct}% — tampil dengan harga coret di storefront.`;
    }
    return 'Kosongkan jika tidak ada diskon. Harus lebih besar dari harga jual.';
  }

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
      discountHint.textContent = discountText();
    }
  });

  const preview = el('div', {
    style: 'font-family:var(--font-h);font-weight:800;font-size:22px;letter-spacing:-0.02em;color:var(--color-primary);margin-top:4px'
  }, formatIDR(form.price));

  const originalInput = el('input', {
    name: 'original_price',
    type: 'number',
    min: '0',
    step: '1000',
    value: form.original_price || '',
    placeholder: '0',
    oninput: (e) => {
      setField('original_price', Number(e.target.value) || 0);
      discountHint.textContent = discountText();
    }
  });

  const discountHint = el('div', { class: 'hint', style: 'margin-top:4px' }, discountText());

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

    el('div', { class: 'field' },
      el('label', {}, 'Harga Coret / Sebelum Diskon (Rp)'),
      originalInput,
      discountHint
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
