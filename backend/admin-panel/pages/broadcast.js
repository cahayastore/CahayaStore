/* Broadcast page — send a message to all Telegram bot users. */
import { el, $, alertBox, toast } from '../dom.js';
import { api } from '../api.js';
import { shell } from '../shell.js';

let pollTimer = null;

function statusLine(s) {
  if (!s || s.status === 'idle') return 'Belum ada broadcast.';
  const map = { running: '⏳ Berjalan', done: '✅ Selesai', cancelled: '🛑 Dibatalkan', error: '⚠️ Error' };
  const label = map[s.status] || s.status;
  const total = s.total || 0;
  const sent = s.sent || 0;
  const failed = s.failed || 0;
  return `${label} — terkirim ${sent}/${total}` + (failed ? `, gagal ${failed}` : '');
}

export async function pageBroadcast() {
  const wrap = el('div', {},
    el('div', { class: 'page-head' }, el('h1', {}, 'Broadcast Telegram')),
    el('div', { id: 'bc' }, el('p', { class: 'muted' }, 'Memuat...'))
  );

  try {
    const aud = await api('/api/admin/broadcast/audience');
    const recipients = aud.data.recipients;

    const textArea = el('textarea', {
      id: 'bc-text', rows: '7',
      placeholder: 'Tulis pesan broadcast di sini...\nMendukung HTML: <b>tebal</b>, <i>miring</i>, <a href="...">link</a>',
      style: 'width:100%;font-family:inherit;font-size:14px;padding:12px;border-radius:10px;'
    });

    const status = el('div', { class: 'muted', id: 'bc-status', style: 'margin-top:8px' }, 'Belum ada broadcast.');

    const sendBtn = el('button', { class: 'btn primary', type: 'button' }, `📣 Kirim ke ${recipients} user`);
    const cancelBtn = el('button', { class: 'btn ghost', type: 'button', style: 'margin-left:8px;display:none' }, 'Batalkan');

    async function refreshStatus() {
      try {
        const st = await api('/api/admin/broadcast/status');
        const s = st.data;
        status.textContent = statusLine(s);
        const running = s && s.status === 'running';
        sendBtn.disabled = running;
        cancelBtn.style.display = running ? 'inline-flex' : 'none';
        if (!running && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      } catch (e) { /* ignore poll errors */ }
    }

    sendBtn.addEventListener('click', async () => {
      const text = textArea.value.trim();
      if (!text) { toast('Pesan masih kosong.', 'err'); return; }
      if (!confirm(`Kirim broadcast ke ${recipients} user?`)) return;
      sendBtn.disabled = true;
      try {
        await api('/api/admin/broadcast', { method: 'POST', body: JSON.stringify({ text, parseMode: 'HTML' }) });
        toast('Broadcast dimulai.', 'ok');
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(refreshStatus, 1500);
        refreshStatus();
      } catch (e) {
        toast(e.message, 'err');
        sendBtn.disabled = false;
      }
    });

    cancelBtn.addEventListener('click', async () => {
      try { await api('/api/admin/broadcast/cancel', { method: 'POST' }); toast('Dibatalkan.', 'ok'); refreshStatus(); }
      catch (e) { toast(e.message, 'err'); }
    });

    const body = el('div', { class: 'card', style: 'padding:18px' },
      el('p', { class: 'muted', style: 'margin-top:0' },
        `Pesan akan dikirim ke semua ${recipients} user yang pernah memakai bot. ` +
        'Pengiriman dibatasi ~20 pesan/detik agar aman dari limit Telegram.'),
      textArea,
      el('div', { style: 'margin-top:14px' }, sendBtn, cancelBtn),
      status
    );

    $('#bc', wrap).innerHTML = '';
    $('#bc', wrap).appendChild(body);
    refreshStatus();
  } catch (e) {
    $('#bc', wrap).innerHTML = '';
    $('#bc', wrap).appendChild(alertBox('err', e.message));
  }

  return shell(wrap);
}
