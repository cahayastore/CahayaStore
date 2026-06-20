/* Stock-alert template page — admin configures the broadcast message sent to
   all bot users automatically when stock is added. Stored in settings key
   stock.alert: { enabled, template, imageUrl }. */
import { el, $, alertBox, toast } from '../dom.js';
import { api } from '../api.js';
import { shell } from '../shell.js';
import { buildImageUpload } from '../upload-widget.js';

const KEY = 'stock.alert';
const DEFAULT_TPL =
  '🎉 <b>Stok Baru Tersedia!</b>\n\n' +
  '📦 {produk}\n' +
  '💰 Harga: {harga}\n' +
  '📥 Stok sekarang: {stok}\n\n' +
  'Buruan order sebelum kehabisan! Ketik /start untuk belanja.';

export async function pageStockAlert() {
  const wrap = el('div', {},
    el('div', { class: 'page-head' }, el('h1', {}, 'Notifikasi Stok')),
    el('div', { id: 'sa' }, el('p', { class: 'muted' }, 'Memuat...'))
  );

  async function load() {
    const container = $('#sa', wrap);
    try {
      const r = await api(`/api/admin/settings/${encodeURIComponent(KEY)}`);
      const cfg = (r && r.value) || {};
      const enabled = !!cfg.enabled;

      const enableChk = el('input', { type: 'checkbox', id: 'sa-enabled' });
      if (enabled) enableChk.checked = true;
      const enableRow = el('label', { style: 'display:flex;align-items:center;gap:10px;margin:0 0 16px;cursor:pointer' },
        enableChk, el('span', {}, 'Kirim broadcast otomatis saat stok ditambahkan')
      );

      const textArea = el('textarea', {
        rows: '8',
        style: 'width:100%;font-family:inherit;font-size:14px;padding:12px;border-radius:10px',
      });
      textArea.value = (cfg.template != null ? cfg.template : DEFAULT_TPL);

      let imageUrl = cfg.imageUrl || '';
      const imageUpload = buildImageUpload({
        value: imageUrl, preset: 'banner',
        onChange: (url) => { imageUrl = url || ''; },
      });

      const saveBtn = el('button', { class: 'btn primary', type: 'button' }, 'Simpan');
      saveBtn.addEventListener('click', async () => {
        const payload = { enabled: enableChk.checked, template: textArea.value.trim(), imageUrl: imageUrl || '' };
        if (payload.enabled && !payload.template) { toast('Template pesan wajib diisi.', 'err'); return; }
        saveBtn.disabled = true;
        try {
          await api(`/api/admin/settings/${encodeURIComponent(KEY)}`, { method: 'PUT', body: JSON.stringify({ value: payload }) });
          toast('Tersimpan.', 'ok');
          load();
        } catch (e) { toast(e.message, 'err'); saveBtn.disabled = false; }
      });

      const card = el('div', { class: 'card', style: 'padding:18px;max-width:640px' },
        el('p', { class: 'muted', style: 'margin-top:0' },
          'Saat kamu menambahkan stok produk, bot otomatis mengirim pesan ini ke semua user. ' +
          'Pengiriman dibatasi ~20 pesan/detik dan berjalan di latar belakang.'),
        enableRow,
        el('div', { class: 'field' },
          el('label', {}, 'Template Pesan'),
          textArea,
          el('div', { class: 'hint', style: 'margin-top:6px' },
            'Placeholder: {produk}, {harga}, {stok} (sisa stok), {jumlah} (yang baru ditambah). HTML didukung.')
        ),
        el('div', { class: 'field', style: 'margin-top:14px' },
          el('label', {}, 'Gambar (opsional)'),
          el('div', { class: 'hint', style: 'margin-bottom:6px' }, 'Jika diisi, pesan dikirim sebagai foto + caption.'),
          imageUpload
        ),
        el('div', { style: 'margin-top:14px' }, saveBtn)
      );
      container.innerHTML = '';
      container.appendChild(card);
    } catch (e) {
      container.innerHTML = '';
      container.appendChild(alertBox('err', e.message));
    }
  }

  await load();
  return shell(wrap);
}
