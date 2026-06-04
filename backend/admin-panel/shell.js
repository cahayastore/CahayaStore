/* Page shell with sidebar nav */
import { el } from './dom.js';
import { session } from './api.js';

const NAV = [
  { hash: '/dashboard', label: '🏠 Dashboard' },
  { hash: '/products', label: '📦 Produk' },
  { hash: '/categories', label: '🏷️ Kategori' },
  { hash: '/orders', label: '🧾 Pesanan' },
  { hash: '/settings', label: '⚙️ Pengaturan' }
];

function navLink(hash, label) {
  const a = el('a', { href: '#' + hash }, label);
  if (location.hash === '#' + hash) a.classList.add('active');
  return a;
}

export function shell(content) {
  const user = session.getUser() || {};
  const sidebar = el('aside', { class: 'sidebar' },
    el('div', { class: 'brand' },
      el('span', { class: 'logo' }, '⚡'),
      el('span', {}, 'Cahaya Store')
    ),
    el('nav', {}, ...NAV.map(n => navLink(n.hash, n.label))),
    el('div', { class: 'spacer' }),
    el('div', { class: 'userbox' },
      el('div', {}, user.name || ''),
      el('div', { style: 'font-size:12px' }, user.email || ''),
      el('button', {
        class: 'btn ghost small', style: 'margin-top:8px',
        onclick: () => { session.clear(); location.hash = '#/login'; }
      }, 'Logout')
    )
  );
  return el('div', { class: 'layout' }, sidebar, el('main', { class: 'main' }, content));
}
