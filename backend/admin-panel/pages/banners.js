/* Admin page: Banner manager — stored in settings key store.banners */
import { el, alertBox } from '../dom.js';
import { api } from '../api.js';
import { shell } from '../shell.js';
import { buildImageUpload } from '../upload-widget.js';

const SETTING_KEY = 'store.banners';

function uid() {
  return 'b_' + Math.random().toString(36).slice(2, 9);
}

function normalizeItems(value) {
  const items = Array.isArray(value?.items) ? value.items : [];
  return items
    .map((b, i) => ({
      id: String(b.id || uid()),
      image_url: String(b.image_url || ''),
      link: b.link ? String(b.link) : '',
      alt: b.alt ? String(b.alt) : '',
      active: b.active !== false,
      order: Number.isFinite(Number(b.order)) ? Number(b.order) : i
    }))
    .sort((a, b) => a.order - b.order);
}

function bannerRow(item, handlers) {
  const imageUpload = buildImageUpload({
    value: item.image_url || '',
    preset: 'banner',
    onChange: (url) => { item.image_url = url; },
  });

  return el('div', { class: 'banner-item' },
    el('div', { class: 'banner-fields' },
      el('div', { class: 'field' }, el('label', {}, 'Gambar Banner'), imageUpload),
      el('div', { class: 'field' }, el('label', {}, 'Link (opsional)'),
        el('input', { type: 'url', value: item.link, placeholder: 'https://...',
          oninput: (e) => { item.link = e.target.value.trim(); } })),
      el('div', { class: 'field' }, el('label', {}, 'Teks Alt (opsional)'),
        el('input', { type: 'text', value: item.alt, placeholder: 'Deskripsi banner',
          oninput: (e) => { item.alt = e.target.value; } })),
      el('div', { class: 'banner-controls' },
        el('label', { class: 'check' },
          el('input', { type: 'checkbox', checked: item.active,
            onchange: (e) => { item.active = e.target.checked; } }),
          ' Aktif'),
        el('div', { class: 'banner-actions' },
          el('button', { class: 'btn ghost small', type: 'button',
            onclick: () => handlers.move(item, -1) }, '↑'),
          el('button', { class: 'btn ghost small', type: 'button',
            onclick: () => handlers.move(item, 1) }, '↓'),
          el('button', { class: 'btn danger small', type: 'button',
            onclick: () => handlers.remove(item) }, 'Hapus')
        )
      )
    )
  );
}

export async function pageBanners() {
  let items = [];
  try {
    const r = await api('/api/admin/settings/' + SETTING_KEY);
    items = normalizeItems(r.value);
  } catch { items = []; }

  const status = alertBox('', '');
  status.style.display = 'none';
  const list = el('div', { class: 'banner-list' });

  function reorder() {
    items.forEach((it, i) => { it.order = i; });
  }

  function refresh() {
    list.innerHTML = '';
    if (!items.length) {
      list.appendChild(el('p', { class: 'muted' }, 'Belum ada banner. Tambah banner pertama Anda.'));
    } else {
      items.forEach((it) => list.appendChild(bannerRow(it, handlers)));
    }
  }

  const handlers = {
    refresh,
    move(item, dir) {
      const idx = items.indexOf(item);
      const next = idx + dir;
      if (next < 0 || next >= items.length) return;
      [items[idx], items[next]] = [items[next], items[idx]];
      reorder();
      refresh();
    },
    remove(item) {
      items = items.filter((it) => it !== item);
      reorder();
      refresh();
    }
  };

  async function save() {
    reorder();
    const value = {
      items: items.map((it) => ({
        id: it.id,
        image_url: it.image_url,
        link: it.link || null,
        alt: it.alt || '',
        active: it.active !== false,
        order: it.order
      }))
    };
    try {
      await api('/api/admin/settings/' + SETTING_KEY, {
        method: 'PUT',
        body: JSON.stringify({ value, secret: false })
      });
      status.textContent = 'Banner berhasil disimpan.';
      status.className = 'alert ok'; status.style.display = '';
    } catch (err) {
      status.textContent = err.message;
      status.className = 'alert err'; status.style.display = '';
    }
  }

  refresh();

  const wrap = el('div', {},
    el('div', { class: 'page-head' },
      el('div', {},
        el('h1', {}, 'Banner'),
        el('div', { class: 'sub' }, 'Atur banner yang tampil di halaman depan toko.')
      ),
      el('div', { class: 'page-head-actions' },
        el('button', { class: 'btn ghost', type: 'button',
          onclick: () => { items.push({ id: uid(), image_url: '', link: '', alt: '', active: true, order: items.length }); refresh(); } },
          '+ Tambah Banner'),
        el('button', { class: 'btn primary', type: 'button', onclick: save }, 'Simpan')
      )
    ),
    el('div', { class: 'card' }, status, list)
  );

  return shell(wrap);
}
