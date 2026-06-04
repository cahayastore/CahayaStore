/* ════════════════════════════════════════════════════════════════════
   Stock Manager Modal
   List + bulk-add + delete stok untuk satu produk.
   Reuse wizard modal styles (wz-bg, wz-modal, wz-head, ...) supaya hemat CSS.
   ════════════════════════════════════════════════════════════════════ */
import { el, alertBox, formatDate } from '../../dom.js';
import { api } from '../../api.js';
import { STOCK_INPUT_CONFIG, STOCK_CONTENT_MAP, parseStockItems } from './constants.js';

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

function buildAddForm(product, onAdded, status) {
  const cfg = STOCK_INPUT_CONFIG[product.stock_type] || STOCK_INPUT_CONFIG.manual;
  const contentType = STOCK_CONTENT_MAP[product.stock_type];

  if (!contentType) {
    return el('div', {
      style: 'padding:12px 14px;background:var(--color-warning-soft);border:1px dashed color-mix(in srgb,var(--color-warning) 35%,transparent);border-radius:var(--mkd-radius-md);color:color-mix(in srgb,var(--color-warning) 80%,#000);font-size:var(--fs-sm)'
    },
      `Sumber stok produk ini ("${product.stock_type}") tidak mendukung bulk-add via wizard. Set ulang di "Edit Produk" → step Tipe untuk mengaktifkan input stok.`);
  }
  if (cfg.disabled) {
    return el('div', {
      style: 'padding:12px 14px;background:var(--color-warning-soft);border:1px dashed color-mix(in srgb,var(--color-warning) 35%,transparent);border-radius:var(--mkd-radius-md);color:color-mix(in srgb,var(--color-warning) 80%,#000);font-size:var(--fs-sm)'
    }, '⚠️ Upload file akan tersedia di iterasi berikutnya.');
  }

  const textarea = el('textarea', {
    rows: '6',
    placeholder: cfg.placeholder || '',
    style: 'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--fs-md);width:100%;padding:11px 13px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--mkd-radius-md);color:var(--color-text-primary)',
  });

  const counter = el('div', { class: 'muted', style: 'font-size:var(--fs-xs);margin-top:6px' }, '0 item');
  textarea.addEventListener('input', () => {
    counter.textContent = parseStockItems(textarea.value).length + ' item';
  });

  const addBtn = el('button', { class: 'btn primary', type: 'button' }, '+ Tambah ke Stok');
  addBtn.addEventListener('click', async () => {
    const items = parseStockItems(textarea.value);
    if (!items.length) {
      status.textContent = 'Isi minimal satu item.';
      status.className = 'alert err'; status.style.display = '';
      return;
    }
    addBtn.disabled = true;
    addBtn.textContent = 'Menyimpan…';
    try {
      const r = await api(`/api/admin/products/${product.id}/stocks`, {
        method: 'POST',
        body: JSON.stringify({ content_type: contentType, items }),
      });
      textarea.value = '';
      counter.textContent = '0 item';
      status.textContent = `Berhasil menambahkan ${r.count} stok.`;
      status.className = 'alert ok'; status.style.display = '';
      onAdded();
    } catch (e) {
      status.textContent = e.message || 'Gagal menambah stok.';
      status.className = 'alert err'; status.style.display = '';
    } finally {
      addBtn.disabled = false;
      addBtn.textContent = '+ Tambah ke Stok';
    }
  });

  return el('div', {},
    el('p', { class: 'hint', style: 'margin:0 0 8px;color:var(--color-text-muted);font-size:var(--fs-sm)' }, cfg.hint),
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

  const status = alertBox('', '');
  status.style.display = 'none';

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
      reloadList();
    } catch (e) {
      status.textContent = e.message || 'Gagal menghapus stok.';
      status.className = 'alert err'; status.style.display = '';
    }
  }

  const addForm = buildAddForm(product, reloadList, status);

  function render() {
    modal.innerHTML = '';
    modal.appendChild(buildHeader(product, () => {
      closeStockManager();
      if (typeof onDone === 'function') onDone();
    }));

    const body = el('div', { class: 'wz-body' },
      el('h3', { style: 'margin:0 0 6px;font-family:var(--font-h);font-size:15px' }, 'Tambah Stok'),
      addForm,
      status,
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
