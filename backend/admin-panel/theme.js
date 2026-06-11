/* Admin theme (light/dark) toggle — persists to localStorage, applies to <html>. */
const KEY = 'cs-admin-theme';
const root = document.documentElement;

function systemPrefersDark() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveInitial() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* ignore */ }
  if (saved === 'dark' || saved === 'light') return saved;
  return systemPrefersDark() ? 'dark' : 'light';
}

export function applyTheme(theme) {
  root.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
}

export function currentTheme() {
  return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
  applyTheme(next);
  return next;
}

// Apply as early as possible to avoid a flash.
applyTheme(resolveInitial());
