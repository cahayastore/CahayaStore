/* Shared image-upload widget for admin pages.
   Uploads to POST /api/admin/uploads (multipart) and returns the public URL. */
import { el } from './dom.js';
import { API_BASE, session } from './api.js';

async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(API_BASE + '/api/admin/uploads', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.getToken()}` },
    body: fd,
  });
  let body = null;
  try { body = await res.json(); } catch { /* ignore */ }
  if (res.status === 401) { session.clear(); location.hash = '#/login'; throw new Error('Unauthorized'); }
  if (!res.ok || !body?.url) throw new Error((body && body.message) || `Upload gagal (HTTP ${res.status})`);
  return body.url;
}

/**
 * Build an image upload control.
 * @param {object} opts
 * @param {string} opts.value      current image URL
 * @param {function} opts.onChange called with the new URL (or '' when cleared)
 * @param {string} [opts.previewClass]
 * @returns {HTMLElement}
 */
export function buildImageUpload({ value = '', onChange, previewClass = '' }) {
  let current = value || '';

  const preview = el('img', {
    src: current,
    alt: '',
    class: previewClass,
    style: 'width:120px;height:120px;object-fit:cover;border-radius:10px;border:1px solid var(--color-border,#e5e7eb);background:#f4f6f9'
      + (current ? '' : ';display:none'),
    onerror: () => { preview.style.display = 'none'; },
  });

  const status = el('div', { class: 'hint', style: 'margin-top:6px' }, '');

  const fileInput = el('input', {
    type: 'file',
    accept: 'image/*',
    style: 'display:none',
    onchange: async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      status.textContent = 'Mengunggah…';
      btn.disabled = true;
      try {
        const url = await uploadFile(file);
        current = url;
        preview.src = url;
        preview.style.display = '';
        urlInput.value = url;
        status.textContent = 'Berhasil diunggah.';
        if (typeof onChange === 'function') onChange(url);
      } catch (err) {
        status.textContent = err.message;
      } finally {
        btn.disabled = false;
        e.target.value = '';
      }
    },
  });

  const btn = el('button', {
    type: 'button', class: 'btn ghost small',
    onclick: () => fileInput.click(),
  }, '⬆️ Upload Gambar');

  const clearBtn = el('button', {
    type: 'button', class: 'btn ghost small',
    onclick: () => {
      current = '';
      preview.src = '';
      preview.style.display = 'none';
      urlInput.value = '';
      status.textContent = '';
      if (typeof onChange === 'function') onChange('');
    },
  }, 'Hapus');

  // Optional manual URL paste — kept for power users.
  const urlInput = el('input', {
    type: 'url',
    value: current,
    placeholder: 'atau tempel URL gambar…',
    oninput: (e) => {
      current = e.target.value.trim();
      if (current) { preview.src = current; preview.style.display = ''; }
      else { preview.style.display = 'none'; }
      if (typeof onChange === 'function') onChange(current);
    },
  });

  return el('div', { class: 'upload-widget' },
    el('div', { style: 'display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap' },
      preview,
      el('div', { style: 'flex:1;min-width:200px' },
        el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, btn, clearBtn),
        urlInput,
        status
      )
    )
  );
}
