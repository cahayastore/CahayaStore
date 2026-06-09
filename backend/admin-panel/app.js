/* Cahaya Store Admin Panel — entry + router */
import { session } from './api.js';
import { pageLogin } from './pages/login.js';
import { pageDashboard } from './pages/dashboard.js';
import { pageProducts } from './pages/products.js';
import { pageCategories } from './pages/categories.js';
import { pageOrders } from './pages/orders.js';
import { pageBanners } from './pages/banners.js';
import { pageSettings } from './pages/settings.js';

const ROUTES = {
  '#/login': pageLogin,
  '#/dashboard': pageDashboard,
  '#/products': pageProducts,
  '#/categories': pageCategories,
  '#/orders': pageOrders,
  '#/banners': pageBanners,
  '#/settings': pageSettings
};

async function render() {
  const hash = location.hash || '#/dashboard';

  // Auth guard
  if (!session.getToken() && hash !== '#/login') { location.hash = '#/login'; return; }
  if (session.getToken() && hash === '#/login') { location.hash = '#/dashboard'; return; }

  const fn = ROUTES[hash] || pageDashboard;
  try {
    const node = await fn();
    const root = document.getElementById('app');
    root.innerHTML = '';
    root.appendChild(node);
  } catch (e) {
    console.error('[render]', e);
    document.getElementById('app').innerHTML = `<div class="alert err" style="margin:24px">${e.message}</div>`;
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);
