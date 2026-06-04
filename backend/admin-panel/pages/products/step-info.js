/* Step 2 — Info dasar produk (nama, slug, deskripsi, kategori) */
import { el } from '../../dom.js';
import { slugify } from './constants.js';

export function renderStepInfo(ctx) {
  const { form, setField, categories = [] } = ctx;

  const nameInput = el('input', {
    name: 'name',
    value: form.name,
    placeholder: 'Contoh: Akun Netflix Premium 1 Bulan',
    oninput: (e) => {
      setField('name', e.target.value);
      // Auto-update slug jika user belum sentuh slug manual
      if (!ctx.flags.slugTouched) {
        setField('slug', slugify(e.target.value));
        ctx.refreshFieldValue('slug');
      }
    }
  });

  const slugInput = el('input', {
    name: 'slug',
    value: form.slug,
    placeholder: 'akun-netflix-premium-1-bulan',
    oninput: (e) => {
      ctx.flags.slugTouched = true;
      setField('slug', slugify(e.target.value));
      e.target.value = form.slug;
    }
  });

  const descInput = el('textarea', {
    name: 'description',
    rows: '4',
    placeholder: 'Jelaskan apa yang didapat pembeli, garansi, dan catatan penting.',
    oninput: (e) => setField('description', e.target.value)
  }, form.description || '');

  const catSelect = el('select', {
    name: 'category_id',
    onchange: (e) => setField('category_id', e.target.value)
  },
    el('option', { value: '' }, '— Tanpa kategori —')
  );
  categories.forEach(c => {
    const opt = el('option', { value: c.id }, c.name);
    if (form.category_id === c.id) opt.selected = true;
    catSelect.appendChild(opt);
  });

  // expose ke ctx supaya auto-slug bisa refresh value input
  ctx.fieldRefs = ctx.fieldRefs || {};
  ctx.fieldRefs.slug = slugInput;
  ctx.refreshFieldValue = (key) => {
    const node = ctx.fieldRefs && ctx.fieldRefs[key];
    if (node) node.value = form[key] ?? '';
  };

  return el('div', { class: 'wz-step-pane' },
    el('h3', {}, 'Informasi dasar'),
    el('p', { class: 'hint' }, 'Detail yang akan ditampilkan di storefront dan halaman pesanan.'),

    el('div', { class: 'field' }, el('label', {}, 'Nama Produk *'), nameInput),
    el('div', { class: 'field' }, el('label', {}, 'Slug URL *'), slugInput,
      el('div', { class: 'hint', style: 'margin-top:4px' },
        'Otomatis dibuat dari nama, bisa disesuaikan.')),
    el('div', { class: 'field' }, el('label', {}, 'Kategori'), catSelect),
    el('div', { class: 'field' }, el('label', {}, 'Deskripsi'), descInput)
  );
}

export function validateStepInfo(form) {
  if (!form.name || form.name.trim().length < 3) return 'Nama produk minimal 3 karakter.';
  if (!form.slug || form.slug.length < 3) return 'Slug minimal 3 karakter.';
  return null;
}
