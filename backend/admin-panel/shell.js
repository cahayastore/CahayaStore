/* Page shell: sidebar + topbar + main content */
import { el } from './dom.js';
import { session } from './api.js';
import { currentTheme, toggleTheme } from './theme.js';

const NAV = [
  { hash: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { hash: '/analytics', label: 'Analitik', icon: '📊' },
  { hash: '/products', label: 'Produk', icon: '📦' },
  { hash: '/categories', label: 'Kategori', icon: '🏷️' },
  { hash: '/orders', label: 'Pesanan', icon: '🧾' },
  { hash: '/banners', label: 'Banner', icon: '🖼️' },
  { hash: '/payment', label: 'Pembayaran', icon: '💳' },
  { hash: '/settings', label: 'Pengaturan', icon: '⚙️' }
];

function navLink(item, currentHash) {
  const a = el('a', { href: '#' + item.hash },
    el('span', { 'aria-hidden': 'true' }, item.icon),
    el('span', {}, item.label)
  );
  if (currentHash === '#' + item.hash) a.classList.add('active');
  return a;
}

function currentBreadcrumb(hash) {
  const item = NAV.find(n => '#' + n.hash === hash);
  return item ? item.label : 'Dashboard';
}

function logoutButton() {
  return el('button', {
    class: 'btn ghost small',
    onclick: () => { session.clear(); location.hash = '#/login'; }
  }, 'Logout');
}

function buildSidebar(currentHash, user) {
  return el('aside', { class: 'sidebar' },
    el('div', { class: 'brand' },
      el('img', { class: 'brand-logo-img', src: '/admin/assets/logo.png', alt: 'Cahaya Store' })
    ),
    el('nav', {}, ...NAV.map(n => navLink(n, currentHash))),
    el('div', { class: 'spacer' }),
    el('div', { class: 'userbox' },
      el('div', { class: 'name' }, user.name || ''),
      el('div', {}, user.email || ''),
      el('div', { style: 'margin-top:8px' }, logoutButton())
    )
  );
}

function themeToggleButton() {
  const dark = currentTheme() === 'dark';
  const btn = el('button', {
    class: 'btn ghost small theme-toggle',
    type: 'button',
    title: dark ? 'Mode terang' : 'Mode gelap',
    'aria-label': 'Ganti tema',
  }, dark ? '☀️' : '🌙');
  btn.addEventListener('click', () => {
    const next = toggleTheme();
    btn.textContent = next === 'dark' ? '☀️' : '🌙';
    btn.title = next === 'dark' ? 'Mode terang' : 'Mode gelap';
  });
  return btn;
}

function buildTopbar(currentHash) {
  return el('header', { class: 'topbar' },
    el('div', { class: 'breadcrumb' }, 'Admin · ' + currentBreadcrumb(currentHash)),
    el('div', { class: 'topbar-actions' }, themeToggleButton(), logoutButton())
  );
}

export function shell(content) {
  const currentHash = location.hash || '#/dashboard';
  const user = session.getUser() || {};
  const sidebar = buildSidebar(currentHash, user);
  const main = el('div', { class: 'main' },
    buildTopbar(currentHash),
    el('div', { class: 'main-content' }, content)
  );
  return el('div', { class: 'layout' }, sidebar, main);
}
