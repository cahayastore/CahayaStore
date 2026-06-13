/* Step 2 — Info dasar produk (nama, slug, deskripsi, kategori) */
import { el } from '../../dom.js';
import { slugify } from './constants.js';
import { buildImageUpload } from '../../upload-widget.js';

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

  // Warranty controls
  const warrantyLabelField = el('div', {
    class: 'field',
    style: form.warranty_enabled ? '' : 'display:none'
  },
    el('label', {}, 'Label Garansi'),
    el('input', {
      name: 'warranty_label',
      value: form.warranty_label || '',
      placeholder: 'Contoh: Garansi Login, Garansi 7 Hari, Garansi Ganti Baru',
      oninput: (e) => setField('warranty_label', e.target.value)
    }),
    el('div', { class: 'hint', style: 'margin-top:4px' },
      'Teks ini tampil sebagai badge garansi di halaman produk.')
  );

  const warrantyToggle = el('input', {
    type: 'checkbox',
    name: 'warranty_enabled',
    ...(form.warranty_enabled ? { checked: 'checked' } : {}),
    onchange: (e) => {
      setField('warranty_enabled', e.target.checked);
      warrantyLabelField.style.display = e.target.checked ? '' : 'none';
    }
  });

  const imageUpload = buildImageUpload({
    value: form.image_url || '',
    preset: 'product',
    onChange: (url) => setField('image_url', url),
  });

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
    el('div', { class: 'field' }, el('label', {}, 'Slug URL'), slugInput,
      el('div', { class: 'hint', style: 'margin-top:4px' },
        'Otomatis dibuat dari nama. Boleh dikosongkan — sistem akan membuatkan slug unik.')),
    el('div', { class: 'field' }, el('label', {}, 'Kategori'), catSelect),
    el('div', { class: 'field' }, el('label', {}, 'Gambar Produk'), imageUpload,
      el('div', { class: 'hint', style: 'margin-top:4px' },
        'Upload gambar (maks 4MB) atau tempel URL. Kosongkan untuk pakai inisial.')),
    el('div', { class: 'field' }, el('label', {}, 'Deskripsi'), descInput),
    el('div', { class: 'field' },
      el('label', { style: 'display:flex;align-items:center;gap:8px;cursor:pointer' },
        warrantyToggle,
        el('span', {}, 'Aktifkan Garansi')
      ),
      el('div', { class: 'hint', style: 'margin-top:4px' },
        'Tampilkan badge garansi di halaman produk storefront & mini app.')
    ),
    warrantyLabelField
  );
}

export function validateStepInfo(form) {
  if (!form.name || form.name.trim().length < 3) return 'Nama produk minimal 3 karakter.';
  // Slug optional — server auto-generates a unique slug from the name when blank.
  return null;
}
