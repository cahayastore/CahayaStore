/* Broadcast page — send a message to all Telegram bot users.
   Compact, mobile-friendly layout with an iOS-style toggle. */
import { el, $, alertBox, toast } from '../dom.js';
import { api } from '../api.js';
import { shell } from '../shell.js';
import { buildImageUpload } from '../upload-widget.js';

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

/* iOS-style toggle switch. Returns { wrap, input }. */
function buildToggle(id, labelText) {
  const input = el('input', { type: 'checkbox', id, class: 'ios-toggle-input' });
  const slider = el('span', { class: 'ios-toggle-slider' });
  const sw = el('label', { class: 'ios-toggle', for: id }, input, slider);
  const wrap = el('div', { class: 'bc-toggle-row' },
    el('span', { class: 'bc-toggle-label' }, labelText),
    sw
  );
  return { wrap, input };
}

export async function pageBroadcast() {
  const wrap = el('div', { class: 'bc-page' },
    el('div', { class: 'page-head' }, el('h1', {}, 'Broadcast Telegram')),
    el('div', { id: 'bc' }, el('p', { class: 'muted' }, 'Memuat...'))
  );

  try {
    const aud = await api('/api/admin/broadcast/audience');
    const recipients = aud.data.recipients;

    const textArea = el('textarea', {
      id: 'bc-text', rows: '5', class: 'bc-textarea',
      placeholder: 'Tulis pesan broadcast…\nHTML didukung: <b>tebal</b>, <i>miring</i>, <a href="…">link</a>',
    });

    // Optional image (sent as photo with the text as caption).
    let imageUrl = '';
    const imageUpload = buildImageUpload({
      value: '',
      preset: 'banner',
      onChange: (url) => { imageUrl = url || ''; },
    });
    const imageField = el('div', { class: 'field bc-field' },
      el('label', {}, 'Gambar (opsional)'),
      el('div', { class: 'bc-hint' }, 'Jika diisi, pesan dikirim sebagai foto + caption (maks. 1024 karakter).'),
      imageUpload
    );

    // Optional inline button that opens the voucher redeem prompt — iOS toggle.
    const { wrap: toggleRow, input: voucherChk } = buildToggle('bc-voucher-chk', '🎟️ Sertakan tombol Tukar Voucher');
    const voucherCode = el('input', {
      id: 'bc-voucher-code', placeholder: 'WELCOME10', disabled: 'true', class: 'bc-vcode',
    });
    const voucherCodeRow = el('div', { class: 'bc-vcode-row', style: 'display:none' },
      el('span', { class: 'bc-hint' }, 'Kode:'), voucherCode
    );
    voucherChk.addEventListener('change', () => {
      voucherCode.disabled = !voucherChk.checked;
      voucherCodeRow.style.display = voucherChk.checked ? 'flex' : 'none';
      if (voucherChk.checked) voucherCode.focus();
    });
    const voucherField = el('div', { class: 'field bc-field' }, toggleRow, voucherCodeRow);

    const status = el('div', { class: 'bc-hint', id: 'bc-status', style: 'margin-top:6px' }, 'Belum ada broadcast.');

    const sendBtn = el('button', { class: 'btn primary small', type: 'button' }, `📣 Kirim ke ${recipients} user`);
    const cancelBtn = el('button', { class: 'btn ghost small', type: 'button', style: 'margin-left:8px;display:none' }, 'Batalkan');

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
      if (!text && !imageUrl) { toast('Pesan atau gambar wajib diisi.', 'err'); return; }
      const useVoucher = voucherChk.checked;
      const vcode = voucherCode.value.trim().toUpperCase();
      if (useVoucher && !vcode) { toast('Isi kode voucher untuk tombolnya.', 'err'); return; }
      if (!confirm(`Kirim broadcast ke ${recipients} user?`)) return;
      sendBtn.disabled = true;
      try {
        await api('/api/admin/broadcast', {
          method: 'POST',
          body: JSON.stringify({
            text, parseMode: 'HTML',
            imageUrl: imageUrl || undefined,
            voucherCode: useVoucher ? vcode : undefined,
          }),
        });
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

    const body = el('div', { class: 'card bc-card' },
      el('p', { class: 'bc-intro' },
        `Kirim ke ${recipients} user bot · dibatasi ~20 pesan/detik.`),
      el('div', { class: 'field bc-field' },
        el('label', {}, 'Pesan'),
        textArea
      ),
      imageField,
      voucherField,
      el('div', { class: 'bc-actions' }, sendBtn, cancelBtn),
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
