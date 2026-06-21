'use strict';
/* ════════════════════════════════════════════════════════════════════
   Rich Messages helper (Telegram Bot API 10.1+, sendRichMessage).
   grammY has no typed method for this yet, so we call the raw HTTP
   endpoint with the bot token taken from ctx.api.token.

   Rich messages can render REAL bordered tables, headings, lists, etc.
   via <table bordered striped>, <th>, <td>, and <a href> inside cells —
   something plain sendMessage(parse_mode:'HTML') cannot do.

   Usage:
     const { sendRichTable, sendRichMessage } = require('./_rich');
     const ok = await sendRichTable(ctx, {
       title: 'LIST PRODUCT',
       columns: ['No', 'Produk', 'Harga'],
       rows: products.map((p, i) => [String(i+1), p.name, rupiah(p.price)]),
       reply_markup,
     });
     if (!ok) { ...fall back to <pre> table... }
   ════════════════════════════════════════════════════════════════════ */

const API_BASE = 'https://api.telegram.org';

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/* Resolve the bot token from a grammy ctx (ctx.api.token) with env fallback. */
function tokenFromCtx(ctx) {
  return (ctx && ctx.api && ctx.api.token) || process.env.TELEGRAM_BOT_TOKEN || null;
}

/* Low-level: POST sendRichMessage with an HTML body. Returns the sent Message
   object on success, or null on any failure (so callers can fall back). */
async function sendRichMessage(ctx, html, opts = {}) {
  const token = tokenFromCtx(ctx);
  const chatId = ctx && ctx.chat && ctx.chat.id;
  if (!token || !chatId || !html) return null;

  const body = {
    chat_id: String(chatId),
    rich_message: { html },
  };
  if (opts.reply_markup) {
    // grammY Keyboard/InlineKeyboard instances already expose the correct
    // shape (keyboard/inline_keyboard + resize/persistent flags) as own
    // enumerable props, so they serialize to a valid ReplyKeyboardMarkup as-is.
    // NOTE: do NOT call .build() — that returns ONLY the button matrix
    // ([[...]]), which Telegram rejects, causing a silent fallback.
    body.reply_markup = opts.reply_markup;
  }
  if (opts.disable_notification) body.disable_notification = true;

  try {
    const res = await fetch(`${API_BASE}/bot${token}/sendRichMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (data && data.ok) return data.result;
    console.error('[rich] sendRichMessage rejected:', data && data.description);
    return null;
  } catch (e) {
    console.error('[rich] sendRichMessage error:', e.message);
    return null;
  }
}

/* Build a bordered/striped HTML table block.
   - title:    optional heading shown above the table (<h3>)
   - columns:  array of header cell strings
   - rows:     array of arrays; each cell is either a string, or
               { text, href } to render a link inside the cell
   - footer:   optional footer line (<footer>) */
function buildTableHtml({ title, columns = [], rows = [], footer } = {}) {
  const cell = (c) => {
    if (c && typeof c === 'object' && c.href) {
      return `<td><a href="${escapeHtml(c.href)}">${escapeHtml(c.text)}</a></td>`;
    }
    return `<td>${escapeHtml(c == null ? '' : c)}</td>`;
  };
  const headRow = columns.length
    ? `<tr>${columns.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`
    : '';
  const bodyRows = rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('');

  const parts = [];
  if (title) parts.push(`<h3>${escapeHtml(title)}</h3>`);
  parts.push(`<table bordered striped>${headRow}${bodyRows}</table>`);
  if (footer) parts.push(`<footer>${escapeHtml(footer)}</footer>`);
  return parts.join('');
}

/* High-level: render a real bordered table as a rich message.
   Returns the sent Message on success, or null so the caller can fall back. */
async function sendRichTable(ctx, { title, columns, rows, footer, reply_markup } = {}) {
  const html = buildTableHtml({ title, columns, rows, footer });
  return sendRichMessage(ctx, html, { reply_markup });
}

module.exports = { sendRichMessage, sendRichTable, buildTableHtml, escapeHtml };
