/* Step 4 — Stok awal produk (opsional).
   Tampilan dependen pada form.stock_type (dipilih di Step 1).
   Format input: textarea, satu item per baris. */
import { el } from '../../dom.js';
import { STOCK_INPUT_CONFIG, parseStockItems } from './constants.js';

function buildSummary(form) {
  const items = parseStockItems(form.stock_items_raw);
  return el('div', {
    style: 'margin-top:10px;padding:10px 12px;background:var(--color-primary-soft);border:1px solid color-mix(in srgb,var(--color-primary) 20%,transparent);border-radius:var(--mkd-radius-md);font-size:var(--fs-sm);font-weight:600;color:var(--color-primary-dark)'
  }, items.length
    ? `Akan menambahkan ${items.length} stok baru.`
    : 'Belum ada item — produk akan dibuat tanpa stok awal.');
}

export function renderStepStock(ctx) {
  const { form, setField, isEdit } = ctx;
  const cfg = STOCK_INPUT_CONFIG[form.stock_type] || STOCK_INPUT_CONFIG.manual;

  // Mode edit: arahkan ke modal Kelola Stok tersendiri
  if (isEdit) {
    return el('div', { class: 'wz-step-pane' },
      el('h3', {}, 'Stok'),
      el('p', { class: 'hint' },
        'Pada mode edit, manajemen stok dilakukan di modal terpisah.'),
      el('div', {
        style: 'padding:14px 16px;background:var(--color-surface-soft);border:1px dashed var(--color-border);border-radius:var(--mkd-radius-lg);color:var(--color-text-muted);font-size:var(--fs-sm)'
      },
        'Selesaikan wizard untuk menyimpan perubahan produk. Untuk menambah atau menghapus stok, klik tombol ',
        el('strong', { style: 'color:var(--color-text-primary)' }, '"Stok"'),
        ' di baris produk pada tabel.'
      )
    );
  }

  if (cfg.skipInput) {
    return el('div', { class: 'wz-step-pane' },
      el('h3', {}, cfg.title),
      el('p', { class: 'hint' }, cfg.hint)
    );
  }

  if (cfg.disabled) {
    return el('div', { class: 'wz-step-pane' },
      el('h3', {}, cfg.title),
      el('p', { class: 'hint' }, cfg.hint),
      el('div', {
        style: 'padding:14px 16px;background:var(--color-warning-soft);border:1px dashed color-mix(in srgb,var(--color-warning) 35%,transparent);border-radius:var(--mkd-radius-lg);color:color-mix(in srgb,var(--color-warning) 80%,#000);font-size:var(--fs-sm)'
      }, '⚠️ Upload file akan tersedia di iterasi berikutnya. Lanjut untuk membuat produk tanpa stok dulu.')
    );
  }

  let summary = buildSummary(form);

  const textarea = el('textarea', {
    name: 'stock_items_raw',
    rows: '10',
    placeholder: cfg.placeholder || '',
    style: 'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--fs-md)',
    oninput: (e) => {
      setField('stock_items_raw', e.target.value);
      const next = buildSummary(form);
      summary.replaceWith(next);
      summary = next;
    },
  }, form.stock_items_raw || '');

  return el('div', { class: 'wz-step-pane' },
    el('h3', {}, cfg.title),
    el('p', { class: 'hint' }, cfg.hint),
    el('div', { class: 'field' }, textarea),
    summary
  );
}

export function validateStepStock(_form) {
  // Stock opsional — boleh kosong (produk tetap bisa dibuat tanpa stok awal)
  return null;
}
