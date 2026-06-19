/* Cahaya Store Admin Panel — entry + router */
import './theme.js';
import { session } from './api.js';
import { pageLogin } from './pages/login.js';
import { pageDashboard } from './pages/dashboard.js';
import { pageAnalytics } from './pages/analytics.js';
import { pageProducts } from './pages/products.js';
import { pageCategories } from './pages/categories.js';
import { pageOrders } from './pages/orders.js';
import { pageBanners } from './pages/banners.js';
import { pagePayment } from './pages/payment.js';
import { pageSettings } from './pages/settings.js';
import { pageBroadcast } from './pages/broadcast.js';
import { pageVouchers } from './pages/vouchers.js';
import { pageTopupBonus } from './pages/topup-bonus.js';

const ROUTES = {
  '#/login': pageLogin,
  '#/dashboard': pageDashboard,
  '#/analytics': pageAnalytics,
  '#/products': pageProducts,
  '#/categories': pageCategories,
  '#/orders': pageOrders,
  '#/banners': pageBanners,
  '#/payment': pagePayment,
  '#/settings': pageSettings,
  '#/broadcast': pageBroadcast,
  '#/vouchers': pageVouchers,
  '#/topup-bonus': pageTopupBonus
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
