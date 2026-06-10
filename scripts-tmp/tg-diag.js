'use strict';
require('dotenv').config();
const https = require('https');
const { getSetting, KEYS } = require('../src/settings.service');

function tg(token, method) {
  return new Promise((resolve) => {
    https.get(`https://api.telegram.org/bot${token}/${method}`, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve({ ok: false, raw: buf }); } });
    }).on('error', (e) => resolve({ ok: false, error: e.message }));
  });
}

(async () => {
  const cfg = await getSetting(KEYS.TELEGRAM_BOT);
  if (!cfg) { console.log('CONFIG: telegram.bot BELUM diset (null)'); process.exit(0); }
  console.log('CONFIG fields:',
    'token=' + (cfg.token ? 'SET(len ' + String(cfg.token).length + ')' : 'MISSING'),
    '| username=' + (cfg.username || '(none)'),
    '| webhook_secret=' + (cfg.webhook_secret ? 'SET' : 'MISSING'));

  if (!cfg.token) { console.log('Tidak bisa cek API: token kosong.'); process.exit(0); }

  const me = await tg(cfg.token, 'getMe');
  console.log('getMe ok=' + me.ok, me.ok ? ('@' + me.result.username + ' (id ' + me.result.id + ')') : JSON.stringify(me).slice(0, 160));

  const wh = await tg(cfg.token, 'getWebhookInfo');
  if (wh.ok) {
    const r = wh.result;
    console.log('Webhook URL =', r.url || '(BELUM DIDAFTARKAN)');
    console.log('pending_updates =', r.pending_update_count, '| last_error =', r.last_error_message || 'none');
  } else {
    console.log('getWebhookInfo gagal:', JSON.stringify(wh).slice(0, 160));
  }
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
