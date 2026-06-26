/* ════════════════════════════════════════════════════════════════════
   Stock Manager Modal
   List + bulk-add + delete stok untuk satu produk.
   Reuse wizard modal styles (wz-bg, wz-modal, wz-head, ...) supaya hemat CSS.
   ════════════════════════════════════════════════════════════════════ */
import { el, alertBox, toast, formatDate } from '../../dom.js';
import { api } from '../../api.js';
import { STOCK_CONTENT_MAP, parseStockItems } from './constants.js';

const STATUS_LABEL = {
  available: 'Tersedia',
  reserved:  'Direservasi',
  sold:      'Terjual',
  disabled:  'Dinonaktifkan',
};
const STATUS_CLASS = {
  available: 'ok',
  reserved:  'warn',
  sold:      'danger',
  disabled:  '',
};

function closeStockManager() {
  document.getElementById('stock-manager')?.remove();
}

function buildHeader(product, onClose) {
  return el('div', { class: 'wz-head' },
    el('div', { class: 'title' },
      el('div', { class: 'icon' }, '📦'),
      el('div', {},
        el('div', {}, 'Kelola Stok'),
        el('div', { class: 'sub' }, product.name)
      )
    ),
    el('button', { class: 'close', type: 'button', onclick: onClose, 'aria-label': 'Tutup' }, '✕')
  );
}

function buildStockRow(s, onDelete) {
  return el('tr', {},
    el('td', {},
      el('span', {
        class: 'badge ' + (STATUS_CLASS[s.status] || ''),
      }, STATUS_LABEL[s.status] || s.status)
    ),
    el('td', {},
      el('span', {
        class: 'badge',
        style: 'background:var(--color-surface-soft);color:var(--color-text-muted);border-color:var(--color-border)'
      }, s.content_type)
    ),
    el('td', { class: 'muted', style: 'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--fs-xs)' },
      s.preview || s.file_path || '—'
    ),
    el('td', { class: 'muted', style: 'font-size:var(--fs-xs)' }, formatDate(s.created_at)),
    el('td', {},
      s.status === 'sold'
        ? el('span', { class: 'muted', style: 'font-size:var(--fs-xs)' }, '—')
        : el('button', {
            class: 'btn danger small',
            onclick: () => onDelete(s.id),
          }, 'Hapus')
    )
  );
}

function buildStockList(stocks, onDelete) {
  if (!stocks.length) {
    return el('div', {
      style: 'padding:24px;text-align:center;color:var(--color-text-muted);background:var(--color-surface-soft);border:1px dashed var(--color-border);border-radius:var(--mkd-radius-lg)'
    }, 'Belum ada stok untuk produk ini.');
  }
  const t = el('table', { class: 'table' },
    el('thead', {}, el('tr', {},
      el('th', {}, 'Status'),
      el('th', {}, 'Tipe'),
      el('th', {}, 'Konten'),
      el('th', {}, 'Dibuat'),
      el('th', {}, '')
    ))
  );
  const tb = el('tbody');
  stocks.forEach(s => tb.appendChild(buildStockRow(s, onDelete)));
  t.appendChild(tb);
  return t;
}

function buildAddForm(product, onAdded) {
  // Always allow adding stock via a content-type selector, regardless of the
  // product's configured stock_type. This decouples stock from the wizard.
  const CONTENT_OPTIONS = [
    { value: 'code', label: 'Kode / Voucher / Link', placeholder: 'ABCD-1234-EFGH\nhttps://drive.google.com/...' },
    { value: 'credential', label: 'Akun (email:password)', placeholder: 'user1@example.com:passw0rd\nuser2@example.com:passw0rd:2fa' },
    { value: 'barcode', label: 'Barcode (nilai → gambar)', placeholder: '8991234567890\nVCH-2026-0001' },
    { value: 'note', label: 'Catatan / Teks', placeholder: 'Instruksi atau teks lain, satu baris = satu stok' },
  ];

  const SYMBOLOGY_OPTIONS = [
    { value: 'code128', label: 'Code128 (umum 1D)' },
    { value: 'ean13', label: 'EAN-13 (13 digit ritel)' },
    { value: 'qrcode', label: 'QR Code (2D)' },
    { value: 'auto', label: 'Auto (deteksi dari nilai)' },
    { value: 'image', label: 'Upload Gambar (1 gambar = 1 stok)' },
  ];
  let barcodeSymbology = 'code128';
  const uploadedImages = []; // URLs of uploaded barcode images (symbology 'image')

  // Pick a sensible default based on the product stock_type.
  const defaultType = STOCK_CONTENT_MAP[product.stock_type] || 'code';
  let contentType = CONTENT_OPTIONS.some((o) => o.value === defaultType) ? defaultType : 'code';

  // Symbology selector — only visible when content type is 'barcode'.
  const symbologySelect = el('select', {
    style: 'width:100%;padding:10px 12px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--mkd-radius-md);color:var(--color-text-primary);margin-bottom:10px',
    onchange: (e) => { barcodeSymbology = e.target.value; toggleImageMode(); },
  });
  SYMBOLOGY_OPTIONS.forEach((o) => {
    const opt = el('option', { value: o.value }, o.label);
    if (o.value === barcodeSymbology) opt.selected = true;
    symbologySelect.appendChild(opt);
  });
  const symbologyWrap = el('div', { style: 'display:none' },
    el('label', { class: 'muted', style: 'display:block;font-size:var(--fs-xs);margin-bottom:4px' }, 'Jenis barcode'),
    symbologySelect
  );

  // Image-upload UI (only for barcode + symbology 'image').
  const imgPreview = el('div', {
    style: 'display:flex;flex-wrap:wrap;gap:8px;margin:6px 0',
  });
  function renderImgPreview() {
    imgPreview.innerHTML = '';
    uploadedImages.forEach((url, i) => {
      imgPreview.appendChild(el('div', { style: 'position:relative' },
        el('img', { src: url, style: 'width:84px;height:54px;object-fit:contain;background:#fff;border:1px solid var(--color-border);border-radius:8px' }),
        el('button', {
          class: 'btn danger small', type: 'button',
          style: 'position:absolute;top:-8px;right:-8px;padding:1px 6px;line-height:1;border-radius:999px',
          onclick: () => { uploadedImages.splice(i, 1); renderImgPreview(); updateCounter(); },
        }, '✕')
      ));
    });
  }
  const fileInput = el('input', {
    type: 'file', accept: 'image/*', multiple: true,
    style: 'width:100%;font-size:var(--fs-sm);margin-bottom:8px',
    onchange: async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      fileInput.disabled = true;
      const total = files.length;
      let done = 0, failed = 0;
      uploadStatus.textContent = `Mengunggah 0/${total}…`;

      // Upload one image to the barcode (lossless) preset.
      const uploadOne = async (f) => {
        try {
          const fd = new FormData();
          fd.append('file', f);
          const r = await api('/api/admin/uploads?preset=barcode', { method: 'POST', body: fd });
          if (r && r.url) uploadedImages.push(r.url);
          else failed++;
        } catch (err) {
          failed++;
        } finally {
          done++;
          uploadStatus.textContent = `Mengunggah ${done}/${total}…`;
          renderImgPreview();
          updateCounter();
        }
      };

      // Bounded parallelism (5 at a time) — fast for bulk without flooding.
      const CONCURRENCY = 5;
      const queue = files.slice();
      const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (queue.length) { await uploadOne(queue.shift()); }
      });
      await Promise.all(workers);

      uploadStatus.textContent = failed
        ? `Selesai: ${total - failed} berhasil, ${failed} gagal.`
        : `Selesai: ${total} gambar terunggah.`;
      if (failed) toast(`${failed} gambar gagal diunggah.`, 'err');
      e.target.value = '';
      fileInput.disabled = false;
      renderImgPreview();
      updateCounter();
    },
  });
  const uploadStatus = el('div', { class: 'muted', style: 'font-size:var(--fs-xs);margin-bottom:6px' }, '');
  const imageWrap = el('div', { style: 'display:none' },
    el('label', { class: 'muted', style: 'display:block;font-size:var(--fs-xs);margin-bottom:4px' }, 'Unggah gambar barcode (boleh banyak — tiap gambar jadi 1 stok)'),
    fileInput,
    uploadStatus,
    imgPreview
  );

  function toggleImageMode() {
    const isImage = contentType === 'barcode' && barcodeSymbology === 'image';
    imageWrap.style.display = isImage ? 'block' : 'none';
    textarea.style.display = isImage ? 'none' : 'block';
    updateCounter();
  }

  const select = el('select', {
    style: 'width:100%;padding:10px 12px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--mkd-radius-md);color:var(--color-text-primary);margin-bottom:10px',
    onchange: (e) => {
      contentType = e.target.value;
      const opt = CONTENT_OPTIONS.find((o) => o.value === contentType);
      if (opt) textarea.placeholder = opt.placeholder;
      symbologyWrap.style.display = contentType === 'barcode' ? 'block' : 'none';
      toggleImageMode();
    },
  });
  CONTENT_OPTIONS.forEach((o) => {
    const opt = el('option', { value: o.value }, o.label);
    if (o.value === contentType) opt.selected = true;
    select.appendChild(opt);
  });
  if (contentType === 'barcode') symbologyWrap.style.display = 'block';

  const startPlaceholder = (CONTENT_OPTIONS.find((o) => o.value === contentType) || {}).placeholder || '';
  const textarea = el('textarea', {
    rows: '6',
    placeholder: startPlaceholder,
    style: 'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--fs-md);width:100%;padding:11px 13px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--mkd-radius-md);color:var(--color-text-primary)',
  });

  const counter = el('div', { class: 'muted', style: 'font-size:var(--fs-xs);margin-top:6px' }, '0 item');
  function updateCounter() {
    const n = (contentType === 'barcode' && barcodeSymbology === 'image')
      ? uploadedImages.length
      : parseStockItems(textarea.value).length;
    counter.textContent = n + ' item';
  }
  textarea.addEventListener('input', updateCounter);

  const addBtn = el('button', { class: 'btn primary', type: 'button' }, '+ Tambah ke Stok');
  addBtn.addEventListener('click', async () => {
    const isImage = contentType === 'barcode' && barcodeSymbology === 'image';
    const items = isImage ? uploadedImages.slice() : parseStockItems(textarea.value);
    if (!items.length) {
      toast(isImage ? 'Unggah minimal satu gambar.' : 'Isi minimal satu item.', 'err');
      return;
    }
    addBtn.disabled = true;
    addBtn.textContent = 'Menyimpan…';
    try {
      const payload = { content_type: contentType, items };
      if (contentType === 'barcode') payload.barcode_symbology = barcodeSymbology;
      const r = await api(`/api/admin/products/${product.id}/stocks`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      textarea.value = '';
      uploadedImages.length = 0;
      renderImgPreview();
      updateCounter();
      toast(`Berhasil menambahkan ${r.count} stok.`, 'ok');
      onAdded();
    } catch (e) {
      toast(e.message || 'Gagal menambah stok.', 'err');
    } finally {
      addBtn.disabled = false;
      addBtn.textContent = '+ Tambah ke Stok';
    }
  });

  toggleImageMode();

  return el('div', {},
    el('p', { class: 'hint', style: 'margin:0 0 8px;color:var(--color-text-muted);font-size:var(--fs-sm)' },
      'Pilih jenis konten, lalu masukkan satu item per baris. Tiap baris = satu stok. URL otomatis dikirim sebagai link. Untuk barcode: masukkan nilai (bot render gambar) atau pilih “Upload Gambar” untuk mengunggah gambar barcode siap pakai.'),
    select,
    symbologyWrap,
    imageWrap,
    textarea,
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-top:10px;flex-wrap:wrap;gap:8px' },
      counter,
      addBtn
    )
  );
}

/**
 * Buka modal kelola stok untuk produk tertentu.
 * @param {object} opts
 * @param {object} opts.product
 * @param {function} opts.onDone dipanggil saat modal ditutup (untuk reload list produk)
 */
export function openStockManager({ product, onDone }) {
  closeStockManager();
  const root = el('div', { class: 'wz-bg', id: 'stock-manager' });
  const modal = el('div', { class: 'wz-modal', role: 'dialog', 'aria-modal': 'true' });
  root.appendChild(modal);
  document.body.appendChild(root);

  const listHost = el('div', { id: 'stock-list-host' },
    el('p', { class: 'muted' }, 'Memuat…'));

  async function reloadList() {
    try {
      listHost.innerHTML = '';
      listHost.appendChild(el('p', { class: 'muted' }, 'Memuat…'));
      const r = await api(`/api/admin/products/${product.id}/stocks`);
      listHost.innerHTML = '';
      listHost.appendChild(buildStockList(r.data || [], onDelete));
    } catch (e) {
      listHost.innerHTML = '';
      listHost.appendChild(alertBox('err', e.message));
    }
  }

  async function onDelete(stockId) {
    if (!confirm('Hapus stok ini? Hanya stok yang belum terjual yang bisa dihapus.')) return;
    try {
      await api(`/api/admin/products/${product.id}/stocks/${stockId}`, { method: 'DELETE' });
      toast('Stok dihapus.', 'ok');
      reloadList();
    } catch (e) {
      toast(e.message || 'Gagal menghapus stok.', 'err');
    }
  }

  const addForm = buildAddForm(product, reloadList);

  function render() {
    modal.innerHTML = '';
    modal.appendChild(buildHeader(product, () => {
      closeStockManager();
      if (typeof onDone === 'function') onDone();
    }));

    const body = el('div', { class: 'wz-body' },
      el('h3', { style: 'margin:0 0 6px;font-family:var(--font-h);font-size:15px' }, 'Tambah Stok'),
      addForm,
      el('h3', { style: 'margin:18px 0 8px;font-family:var(--font-h);font-size:15px' }, 'Stok Tersimpan'),
      listHost
    );
    modal.appendChild(body);

    modal.appendChild(el('div', { class: 'wz-foot' },
      el('div', { class: 'left' }, `Produk: ${product.name}`),
      el('div', { class: 'right' },
        el('button', {
          class: 'btn ghost',
          type: 'button',
          onclick: () => {
            closeStockManager();
            if (typeof onDone === 'function') onDone();
          }
        }, 'Tutup')
      )
    ));
  }

  render();
  reloadList();
}
