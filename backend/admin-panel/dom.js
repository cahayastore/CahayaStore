/* Small DOM helpers shared by all admin pages */
export const $ = (sel, root = document) => root.querySelector(sel);

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return n;
}

export function formatIDR(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
}

export function formatDate(d) {
  try { return new Date(d).toLocaleString('id-ID'); } catch { return String(d || '-'); }
}

export function showModal(title, body, onSave, saveLabel = 'Simpan') {
  closeModal();
  const modal = el('div', { class: 'modal-bg', id: 'modal' },
    el('div', { class: 'modal' },
      el('h2', {}, title),
      body,
      el('div', { class: 'row' },
        el('button', { class: 'btn ghost', onclick: closeModal }, 'Batal'),
        el('button', { class: 'btn primary', onclick: onSave }, saveLabel)
      )
    )
  );
  document.body.appendChild(modal);
}

export function closeModal() {
  document.getElementById('modal')?.remove();
}

export function alertBox(kind, message) {
  return el('div', { class: 'alert ' + kind }, message);
}
