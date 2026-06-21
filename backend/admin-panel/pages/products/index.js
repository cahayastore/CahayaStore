/* ════════════════════════════════════════════════════════════════════
   Products Page (List View)
   Tampilan tabel mirip dashboard.marketku.id, dengan toolbar pencarian
   dan tombol "+ Tambah Produk" yang membuka wizard.
   ════════════════════════════════════════════════════════════════════ */
import { el, formatIDR, alertBox, toast } from '../../dom.js';
import { api } from '../../api.js';
import { shell } from '../../shell.js';
import { PRODUCT_TYPES } from './constants.js';
import { openProductWizard } from './wizard.js';
import { openStockManager } from './stock-manager.js';

function typeLabel(v) {
  return (PRODUCT_TYPES.find(t => t.value === v) || {}).label || v;
}

function rowActions(p, ctx) {
  return el('div', { class: 'row-actions' },
    el('button', {
      class: 'btn ghost small',
      onclick: () => openStockManager({ product: p, onDone: ctx.reload })
    }, 'Stok'),
    el('button', {
      class: 'btn ghost small',
      onclick: () => openProductWizard({
        product: p,
        categories: ctx.categories,
        onDone: ctx.reload,
      })
    }, 'Edit'),
    el('button', {
      class: 'btn ghost small',
      title: p.is_active ? 'Jadikan draft (sembunyikan dari etalase)' : 'Terbitkan produk',
      onclick: async () => {
        const toDraft = !!p.is_active;
        if (!confirm(toDraft ? `Jadikan "${p.name}" sebagai draft? Produk akan disembunyikan dari etalase.` : `Terbitkan "${p.name}" ke etalase?`)) return;
        try {
          await api('/api/admin/products/' + p.id, { method: 'PUT', body: JSON.stringify({ is_active: !toDraft }) });
          toast(toDraft ? 'Produk dijadikan draft.' : 'Produk diterbitkan.', 'ok');
          ctx.reload();
        } catch (e) {
          toast('Gagal: ' + e.message, 'err');
        }
      }
    }, p.is_active ? '📝 Draft' : '🚀 Terbitkan'),
    el('button', {
      class: 'btn danger small',
      onclick: async () => {
        if (!confirm(`Hapus produk "${p.name}"?`)) return;
        try {
          await api('/api/admin/products/' + p.id, { method: 'DELETE' });
          toast('Produk dihapus.', 'ok');
          ctx.reload();
        } catch (e) {
          toast('Gagal menghapus: ' + e.message, 'err');
        }
      }
    }, 'Hapus')
  );
}

function productRow(p, ctx) {
  const catName = p.category_name || (ctx.catMap.get(p.category_id) || '—');
  return el('tr', {},
    el('td', {},
      el('div', { style: 'font-weight:700;color:var(--color-text-primary)' }, p.name),
      el('div', { class: 'muted', style: 'font-size:var(--fs-xs);margin-top:2px' }, p.slug)
    ),
    el('td', {}, catName),
    el('td', {},
      el('span', {
        class: 'badge',
        style: 'background:var(--color-info-soft);color:var(--color-info);border-color:color-mix(in srgb,var(--color-info) 25%,transparent)'
      }, typeLabel(p.product_type))
    ),
    el('td', {}, formatIDR(p.price)),
    el('td', {}, String(p.stock_count || 0)),
    el('td', {},
      el('span', { class: 'badge ' + (p.is_active ? 'ok' : 'warn') },
        p.is_active ? 'Aktif' : '📝 Draft')
    ),
    el('td', {}, rowActions(p, ctx))
  );
}

function buildTable(products, ctx) {
  if (!products.length) {
    return el('div', {
      style: 'padding:48px 16px;text-align:center;color:var(--color-text-muted);background:var(--color-surface);border:1px dashed var(--color-border);border-radius:var(--mkd-radius-lg)'
    },
      el('div', { style: 'font-size:32px;margin-bottom:8px' }, '📦'),
      el('div', { style: 'font-weight:700;color:var(--color-text-primary);margin-bottom:4px' },
        'Belum ada produk'),
      el('div', { class: 'muted' }, 'Klik "+ Tambah Produk" untuk membuat yang pertama.')
    );
  }

  const t = el('table', { class: 'table' },
    el('thead', {}, el('tr', {},
      el('th', {}, 'Produk'),
      el('th', {}, 'Kategori'),
      el('th', {}, 'Tipe'),
      el('th', {}, 'Harga'),
      el('th', {}, 'Stok'),
      el('th', {}, 'Status'),
      el('th', {}, '')
    ))
  );
  const tb = el('tbody');
  products.forEach(p => tb.appendChild(productRow(p, ctx)));
  t.appendChild(tb);
  return t;
}

function applySearch(products, q) {
  const term = (q || '').trim().toLowerCase();
  if (!term) return products;
  return products.filter(p =>
    (p.name || '').toLowerCase().includes(term)
    || (p.slug || '').toLowerCase().includes(term)
    || (p.category_name || '').toLowerCase().includes(term)
  );
}

export async function pageProducts() {
  const state = { all: [], categories: [], query: '' };

  const search = el('input', {
    type: 'search',
    placeholder: '🔎 Cari produk berdasarkan nama, slug, atau kategori…',
    oninput: (e) => {
      state.query = e.target.value;
      renderTable();
    }
  });

  const addBtn = el('button', {
    class: 'btn primary',
    onclick: () => openProductWizard({
      categories: state.categories,
      onDone: reload,
    })
  }, '+ Tambah Produk');

  const tblHost = el('div', { id: 'tbl' }, el('p', { class: 'muted' }, 'Memuat…'));

  const wrap = el('div', {},
    el('div', { class: 'page-head' },
      el('div', {},
        el('h1', {}, 'Produk'),
        el('div', { class: 'sub' }, 'Kelola katalog produk yang dijual di Cahaya Store.')
      ),
      addBtn
    ),
    el('div', { class: 'tbl-toolbar' }, search),
    tblHost
  );

  function renderTable() {
    const filtered = applySearch(state.all, state.query);
    const ctx = {
      categories: state.categories,
      catMap: new Map(state.categories.map(c => [c.id, c.name])),
      reload,
    };
    tblHost.innerHTML = '';
    tblHost.appendChild(buildTable(filtered, ctx));
  }

  async function reload() {
    try {
      tblHost.innerHTML = '';
      tblHost.appendChild(el('p', { class: 'muted' }, 'Memuat…'));
      const [{ data: products }, { data: cats }] = await Promise.all([
        api('/api/admin/products'),
        api('/api/admin/categories'),
      ]);
      state.all = products || [];
      state.categories = cats || [];
      renderTable();
    } catch (e) {
      tblHost.innerHTML = '';
      tblHost.appendChild(alertBox('err', e.message));
    }
  }

  reload();
  return shell(wrap);
}
