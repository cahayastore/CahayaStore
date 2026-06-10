/* ════════════════════════════════════════════════════════════════════
   Change-password card (admin settings page)
   POST /api/auth/change-password { current_password, new_password }
   ════════════════════════════════════════════════════════════════════ */
import { el, toast } from '../../dom.js';
import { api, session } from '../../api.js';

function pwField(name, label, placeholder = '') {
  return el('div', { class: 'field' },
    el('label', {}, label),
    el('input', {
      name,
      type: 'password',
      autocomplete: 'new-password',
      placeholder,
      required: true,
    })
  );
}

function meterColor(score) {
  if (score >= 4) return 'var(--color-success)';
  if (score >= 3) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

function scorePassword(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 14) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(s, 5);
}

export function buildChangePasswordCard() {
  const meter = el('div', {
    style: 'height:6px;border-radius:999px;background:var(--color-border);overflow:hidden;margin-top:6px',
  }, el('div', {
    style: 'height:100%;width:0;background:var(--color-danger);transition:width .2s,background .2s',
  }));
  const meterLabel = el('div', {
    class: 'muted',
    style: 'font-size:var(--fs-xs);margin-top:4px',
  }, 'Minimal 10 karakter. Disarankan campuran huruf, angka & simbol.');

  const form = el('form', { autocomplete: 'off' });
  const fCurrent = pwField('current_password', 'Password Saat Ini');
  const fNew = pwField('new_password', 'Password Baru', 'Minimal 10 karakter');
  const fConfirm = pwField('confirm_password', 'Ulangi Password Baru');

  // Live strength meter
  const newInput = fNew.querySelector('input');
  newInput.addEventListener('input', () => {
    const s = scorePassword(newInput.value);
    const bar = meter.firstChild;
    bar.style.width = (s * 20) + '%';
    bar.style.background = meterColor(s);
  });

  form.appendChild(fCurrent);
  form.appendChild(fNew);
  form.appendChild(meter);
  form.appendChild(meterLabel);
  form.appendChild(fConfirm);

  const submitBtn = el('button', { class: 'btn primary', type: 'submit' }, 'Ubah Password');
  form.appendChild(submitBtn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const current_password = String(fd.get('current_password') || '');
    const new_password = String(fd.get('new_password') || '');
    const confirm_password = String(fd.get('confirm_password') || '');

    if (new_password.length < 10) {
      toast('Password baru minimal 10 karakter.', 'err');
      return;
    }
    if (new_password !== confirm_password) {
      toast('Konfirmasi password tidak cocok.', 'err');
      return;
    }
    if (new_password === current_password) {
      toast('Password baru harus berbeda dari password lama.', 'err');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Menyimpan…';
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ current_password, new_password }),
      });
      toast('Password berhasil diubah. Silakan login ulang.', 'ok');
      form.reset();
      const bar = meter.firstChild;
      bar.style.width = '0';
      // Force re-login setelah 1.5s
      setTimeout(() => {
        session.clear();
        location.hash = '#/login';
      }, 1500);
    } catch (err) {
      toast(err.message || 'Gagal mengubah password.', 'err');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Ubah Password';
    }
  });

  return el('div', {},
    el('p', { class: 'muted', style: 'margin:0 0 14px' },
      'Untuk keamanan, ganti password sementara dengan password pribadi yang kuat.'),
    form
  );
}
