/* Cahaya Design System — theme (light/dark) toggle.
   - Applies the saved theme to <html data-theme> as early as possible.
   - Binds any [data-theme-toggle] button to flip + persist the choice.
   - Falls back to the OS preference when the user hasn't chosen yet. */
(function () {
  var KEY = 'cds-theme';
  var root = document.documentElement;

  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function resolveInitial() {
    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) { /* ignore */ }
    if (saved === 'dark' || saved === 'light') return saved;
    return systemPrefersDark() ? 'dark' : 'light';
  }

  function apply(theme) {
    if (theme === 'dark') root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(theme === 'dark'));
      btn.setAttribute('title', theme === 'dark' ? 'Mode terang' : 'Mode gelap');
    });
  }

  // Apply immediately (before paint where possible).
  apply(resolveInitial());

  function current() {
    return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function toggle() {
    var next = current() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
    apply(next);
  }

  function bind() {
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      if (btn.dataset.themeBound) return;
      btn.dataset.themeBound = '1';
      btn.addEventListener('click', function (e) { e.preventDefault(); toggle(); });
    });
    apply(current());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
