import { el, alertBox } from '../dom.js';
import { api, session } from '../api.js';

export function pageLogin() {
  const errBox = alertBox('err', '');
  errBox.style.display = 'none';

  const form = el('form', { class: 'login-card' },
    el('img', { src: '/admin/assets/logo.png', alt: 'Cahaya Store', style: 'height:56px;width:auto;object-fit:contain;margin:0 auto 14px;display:block' }),
    el('p', { class: 'sub', style: 'text-align:center' }, 'Masuk ke admin panel'),
    errBox,
    el('div', { class: 'field' },
      el('label', {}, 'Email'),
      el('input', { type: 'email', name: 'email', required: true, autocomplete: 'username' })
    ),
    el('div', { class: 'field' },
      el('label', {}, 'Password'),
      el('input', { type: 'password', name: 'password', required: true, autocomplete: 'current-password' })
    ),
    el('button', { type: 'submit', class: 'btn primary', style: 'width:100%' }, 'Masuk')
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.style.display = 'none';
    const fd = new FormData(form);
    try {
      const r = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') })
      });
      session.set(r.token, r.user);
      location.hash = '#/dashboard';
    } catch (err) {
      errBox.textContent = err.message;
      errBox.style.display = '';
    }
  });

  return el('div', { class: 'login-wrap' }, form);
}
