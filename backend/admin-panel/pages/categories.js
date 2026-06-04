import { el, $, showModal, closeModal, alertBox } from '../dom.js';
import { api } from '../api.js';
import { shell } from '../shell.js';

function rowActions(c, onReload) {
  return el('div', { class: 'row-actions' },
    el('button', { class: 'btn ghost small', onclick: () => openForm(c, onReload) }, 'Edit'),
    el('button', {
      class: 'btn danger small',
      onclick: async () => {
        if (!confirm('Hapus kategori ini?')) return;
        await api('/api/admin/categories/' + c.id, { method: 'DELETE' });
        onReload();
      }
    }, 'Hapus')
  );
}

function openForm(c, onReload) {
  const f = el('form', {},
    el('div', { class: 'field' }, el('label', {}, 'Nama'),
      el('input', { name: 'name', value: c?.name || '', required: true })),
    el('div', { class: 'field' }, el('label', {}, 'Slug'),
      el('input', { name: 'slug', value: c?.slug || '', required: true })),
    el('div', { class: 'field' }, el('label', {},
      el('input', { type: 'checkbox', name: 'is_active', checked: c?.is_active !== false }),
      ' Aktif'))
  );
  showModal(c ? 'Edit Kategori' : 'Tambah Kategori', f, async () => {
    const fd = new FormData(f);
    const body = { name: fd.get('name'), slug: fd.get('slug'), is_active: !!fd.get('is_active') };
    if (c) await api('/api/admin/categories/' + c.id, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/admin/categories', { method: 'POST', body: JSON.stringify(body) });
    closeModal();
    onReload();
  });
}

export async function pageCategories() {
  const wrap = el('div', {},
    el('div', { class: 'page-head' },
      el('h1', {}, 'Kategori'),
      el('button', { class: 'btn primary', onclick: () => openForm(null, reload) }, '+ Tambah Kategori')
    ),
    el('div', { id: 'tbl' }, el('p', { class: 'muted' }, 'Memuat...'))
  );

  async function reload() {
    try {
      const { data } = await api('/api/admin/categories');
      const t = el('table', { class: 'table' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Nama'), el('th', {}, 'Slug'), el('th', {}, 'Status'), el('th', {}, '')
        ))
      );
      const tb = el('tbody');
      for (const c of data) {
        tb.appendChild(el('tr', {},
          el('td', {}, c.name),
          el('td', {}, c.slug),
          el('td', {}, el('span', { class: 'badge ' + (c.is_active ? 'ok' : 'danger') }, c.is_active ? 'Aktif' : 'Nonaktif')),
          el('td', {}, rowActions(c, reload))
        ));
      }
      t.appendChild(tb);
      $('#tbl', wrap).innerHTML = '';
      $('#tbl', wrap).appendChild(t);
    } catch (e) {
      $('#tbl', wrap).innerHTML = '';
      $('#tbl', wrap).appendChild(alertBox('err', e.message));
    }
  }

  reload();
  return shell(wrap);
}
