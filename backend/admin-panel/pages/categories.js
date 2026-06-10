import { el, $, showModal, closeModal, alertBox, toast } from '../dom.js';
import { api } from '../api.js';
import { shell } from '../shell.js';
import { buildImageUpload } from '../upload-widget.js';

function rowActions(c, onReload) {
  return el('div', { class: 'row-actions' },
    el('button', { class: 'btn ghost small', onclick: () => openForm(c, onReload) }, 'Edit'),
    el('button', {
      class: 'btn danger small',
      onclick: async () => {
        if (!confirm('Hapus kategori ini?')) return;
        try {
          await api('/api/admin/categories/' + c.id, { method: 'DELETE' });
          toast('Kategori dihapus.', 'ok');
          onReload();
        } catch (e) {
          toast('Gagal menghapus: ' + e.message, 'err');
        }
      }
    }, 'Hapus')
  );
}

function openForm(c, onReload) {
  const state = { image_url: c?.image_url || '' };
  const imageUpload = buildImageUpload({
    value: state.image_url,
    preset: 'category',
    onChange: (url) => { state.image_url = url; },
  });
  const f = el('form', {},
    el('div', { class: 'field' }, el('label', {}, 'Nama'),
      el('input', { name: 'name', value: c?.name || '', required: true })),
    el('div', { class: 'field' }, el('label', {}, 'Slug'),
      el('input', { name: 'slug', value: c?.slug || '', required: true })),
    el('div', { class: 'field' }, el('label', {}, 'Gambar Kategori'), imageUpload),
    el('div', { class: 'field' }, el('label', {},
      el('input', { type: 'checkbox', name: 'is_active', checked: c?.is_active !== false }),
      ' Aktif'))
  );
  showModal(c ? 'Edit Kategori' : 'Tambah Kategori', f, async () => {
    const fd = new FormData(f);
    const body = { name: fd.get('name'), slug: fd.get('slug'), image_url: state.image_url || null, is_active: !!fd.get('is_active') };
    try {
      if (c) await api('/api/admin/categories/' + c.id, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/api/admin/categories', { method: 'POST', body: JSON.stringify(body) });
      closeModal();
      toast(c ? 'Kategori diperbarui.' : 'Kategori dibuat.', 'ok');
      onReload();
    } catch (e) {
      toast(e.message, 'err');
    }
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
