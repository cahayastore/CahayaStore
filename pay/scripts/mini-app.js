/* ════════════════════════════════════════════════════════════════════
   Cahaya Design System — Telegram Mini App runtime (vanilla).
   Works inside Telegram WebView AND a normal browser (no-op outside TG).
   Exposes window.CahayaMiniApp.* helpers.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  const API = 'https://api.cahayastore.me/api';
  const WEBAPP_SRC = 'https://telegram.org/js/telegram-web-app.js';
  const SESSION_KEY = 'cs_session';
  let scriptPromise = null;

  function ensureTelegramWebAppScript() {
    if (window.Telegram && window.Telegram.WebApp) return Promise.resolve(true);
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise((resolve) => {
      const existing = document.querySelector('script[data-tg-webapp]');
      if (existing) { existing.addEventListener('load', () => resolve(true)); return; }
      const s = document.createElement('script');
      s.src = WEBAPP_SRC;
      s.async = true;
      s.setAttribute('data-tg-webapp', '1');
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    return scriptPromise;
  }

  function getTelegramWebApp() {
    return (window.Telegram && window.Telegram.WebApp) || null;
  }

  function queryFlag(name) {
    return new URLSearchParams(location.search).get(name);
  }

  function isMiniAppRuntime() {
    const wa = getTelegramWebApp();
    if (wa && wa.initData) return true;
    return queryFlag('miniapp') === '1' || queryFlag('tma') === '1';
  }

  function getTelegramMiniAppIdentity() {
    const wa = getTelegramWebApp();
    if (!wa) return { initData: '', user: null };
    return { initData: wa.initData || '', user: (wa.initDataUnsafe && wa.initDataUnsafe.user) || null };
  }

  async function waitForTelegramMiniAppIdentity(timeout = 4000) {
    await ensureTelegramWebAppScript();
    const start = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        const id = getTelegramMiniAppIdentity();
        if (id.initData) return resolve(id);
        if (Date.now() - start > timeout) return resolve(id);
        setTimeout(tick, 120);
      };
      tick();
    });
  }

  function applyTheme(wa) {
    const scheme = (wa && wa.colorScheme) || null;
    if (scheme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      try { localStorage.setItem('cds-theme', 'dark'); } catch (e) {}
    } else if (scheme === 'light') {
      document.documentElement.removeAttribute('data-theme');
      try { localStorage.setItem('cds-theme', 'light'); } catch (e) {}
    }
    // Match Telegram chrome to our surface colors.
    try {
      const surface = getComputedStyle(document.documentElement)
        .getPropertyValue('--cds-bg').trim() || '#0d1320';
      if (wa && wa.setHeaderColor) wa.setHeaderColor(scheme === 'dark' ? '#151c2b' : '#ffffff');
      if (wa && wa.setBackgroundColor) wa.setBackgroundColor(surface || (scheme === 'dark' ? '#0d1320' : '#f4f6f9'));
    } catch (e) {}
  }

  async function prepareMiniAppRuntime() {
    if (!isMiniAppRuntime()) return { miniApp: false };
    await ensureTelegramWebAppScript();
    const wa = getTelegramWebApp();
    if (wa) {
      try { wa.ready(); } catch (e) {}
      try { wa.expand(); } catch (e) {}
      applyTheme(wa);
      try { wa.onEvent && wa.onEvent('themeChanged', () => applyTheme(wa)); } catch (e) {}
      document.documentElement.classList.add('is-miniapp');
    }
    return { miniApp: true, webApp: wa };
  }

  function saveSession(d) {
    let prev = {};
    try { prev = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}'); } catch (e) {}
    const sess = { ...prev };
    if (d.webSessionToken) sess.webSessionToken = d.webSessionToken;
    if (d.gatewaySession) {
      sess.accessToken = d.gatewaySession.accessToken;
      sess.refreshToken = d.gatewaySession.refreshToken;
      sess.user = d.gatewaySession.user;
    }
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(sess)); } catch (e) {}
  }

  /* Exchange initData for a marketplace JWT session (auto-login in Telegram). */
  async function miniAppLogin() {
    if (!isMiniAppRuntime()) return { ok: false, reason: 'not_miniapp' };
    const id = await waitForTelegramMiniAppIdentity();
    if (!id.initData) return { ok: false, reason: 'no_initdata' };
    try {
      const res = await fetch(`${API}/auth/telegram/miniapp-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: id.initData }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) return { ok: false, reason: json.reason || 'login_failed' };
      saveSession(json.data);
      return { ok: true, data: json.data };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  /* Returns the raw initData string (for attaching to checkout payloads). */
  function getInitData() {
    return getTelegramMiniAppIdentity().initData || '';
  }

  // Auto-prepare + auto-login as early as possible in Telegram.
  function boot() {
    if (!isMiniAppRuntime()) return;
    prepareMiniAppRuntime().then(() => { miniAppLogin().catch(() => {}); });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.CahayaMiniApp = {
    ensureTelegramWebAppScript,
    getTelegramWebApp,
    isMiniAppRuntime,
    getTelegramMiniAppIdentity,
    waitForTelegramMiniAppIdentity,
    prepareMiniAppRuntime,
    miniAppLogin,
    getInitData,
  };
})();
