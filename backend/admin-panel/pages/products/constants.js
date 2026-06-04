/* ════════════════════════════════════════════════════════════════════
   Product Wizard — Constants
   Tipe produk & jenis stok yang didukung Cahaya Store (v1).
   ════════════════════════════════════════════════════════════════════ */

export const STEPS = [
  { num: 1, key: 'type',    label: 'Tipe' },
  { num: 2, key: 'info',    label: 'Info' },
  { num: 3, key: 'pricing', label: 'Harga' },
  { num: 4, key: 'review',  label: 'Review' },
];

/* Tipe produk inti (sesuai kolom products.product_type) */
export const PRODUCT_TYPES = [
  {
    value: 'file',
    label: 'File Digital',
    icon: '📁',
    desc: 'Ebook, template, script, atau file digital lain.',
  },
  {
    value: 'account',
    label: 'Akun Premium',
    icon: '👤',
    desc: 'Akun streaming, SaaS, atau layanan premium.',
  },
  {
    value: 'voucher',
    label: 'Voucher / Kode',
    icon: '🎟️',
    desc: 'Voucher game, lisensi, atau kode satu kali pakai.',
  },
];

/* Jenis stok (kolom products.stock_type) */
export const STOCK_TYPES = [
  { value: 'manual',     label: 'Manual',          desc: 'Stok diisi admin manual via panel.' },
  { value: 'code',       label: 'Kode / Voucher',  desc: 'Satu kode = satu stok.' },
  { value: 'account',    label: 'Email:Password',  desc: 'Format akun, satu baris per akun.' },
  { value: 'file',       label: 'File Upload',     desc: 'Satu file digital = satu stok.' },
  { value: 'pre_order',  label: 'Pre-Order',       desc: 'Pesanan diproses manual oleh admin.' },
];

/* Default form state */
export function createDefaultForm() {
  return {
    product_type: 'file',
    stock_type: 'manual',
    name: '',
    slug: '',
    description: '',
    category_id: '',
    price: 0,
    is_active: true,
  };
}

/* Form from existing product (edit mode) */
export function createFormFromProduct(p) {
  return {
    product_type: p.product_type || 'file',
    stock_type: p.stock_type || 'manual',
    name: p.name || '',
    slug: p.slug || '',
    description: p.description || '',
    category_id: p.category_id || '',
    price: Number(p.price) || 0,
    is_active: p.is_active !== false,
  };
}

/* Build payload yang dikirim ke API */
export function buildSubmission(form) {
  return {
    product_type: form.product_type,
    stock_type: form.stock_type,
    name: (form.name || '').trim(),
    slug: (form.slug || '').trim(),
    description: (form.description || '').trim() || null,
    category_id: form.category_id || null,
    price: Math.max(0, Math.round(Number(form.price) || 0)),
    is_active: !!form.is_active,
  };
}

/* Auto-slug dari nama produk */
export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
