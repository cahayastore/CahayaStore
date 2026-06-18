'use strict';
const { InlineKeyboard, InputFile } = require('grammy');
const { ensureTelegramUser, rupiah } = require('./_shared');
const { replyClean, editOrReply } = require('./_reply');
const wallet = require('../../wallet.service');
const { createTopupOrder } = require('../../checkout.service');
const { query } = require('../../db');
const { buildQrisCard } = require('../../qris-card.service');
const { showProductList } = require('./v3-menu');
// Preset top-up amounts (rupiah).
const PRESETS = [10000, 20000, 50000, 100000, 200000, 500000];

async function renderSaldo(ctx) {
  let user = null;
  try { user = await ensureTelegramUser(ctx.from); } catch { /* ignore */ }
  if (!user) return replyClean(ctx, 'Tidak dapat memuat akun kamu. Coba /start dulu.');

  const balance = await wallet.getBalance(user.id);
  const txs = await wallet.listTransactions(user.id, 5);
  const lines = txs.length
    ? txs.map((t) => {
        const sign = Number(t.amount) >= 0 ? '+' : '';
        return `• ${t.type}: ${sign}${rupiah(Math.abs(t.amount))}`;
      }).join('\n')
    : 'Belum ada transaksi.';

  const kb = new InlineKeyboard();
  PRESETS.forEach((amt, i) => {
    kb.text(rupiah(amt), `tu:amt:${amt}`);
    if ((i + 1) % 2 === 0) kb.row();
  });
  if (PRESETS.length % 2 !== 0) kb.row();
  kb.text('✏️ Nominal Lain', 'tu:custom').row();

  await replyClean(ctx,
    `💰 <b>Saldo kamu: ${rupiah(balance)}</b>\n\n` +
    `<b>Transaksi terakhir</b>\n${lines}\n\n` +
    `Pilih nominal top up di bawah:`,
    { reply_markup: kb }
  );
}

async function createAndShowTopupQris(ctx, amount) {
  let user = null;
  try { user = await ensureTelegramUser(ctx.from); } catch { /* ignore */ }
  if (!user) return editOrReply(ctx, 'Gagal memproses akun. Coba /start dulu.');

  const handle = ctx.from && ctx.from.username
    ? String(ctx.from.username).toLowerCase().replace(/[^a-z0-9_]/g, '') : '';
  const email = user.email || (handle ? `${handle}@telegram.cahayastore.me` : `tg${ctx.from.id}@telegram.cahayastore.me`);

  let res;
  try {
    res = await createTopupOrder({ customer: { id: user.id, email }, amount, channel: 'telegram' });
  } catch (e) {
    console.error('[topup create]', e.message);
    return editOrReply(ctx, `Gagal membuat top up: ${e.message}`);
  }

  const uniqueCode = Math.max(0, Number(res.amount) - Number(res.baseAmount));
  const mins = res.expiresAt ? Math.max(1, Math.round((new Date(res.expiresAt).getTime() - Date.now()) / 60000)) : 5;
  const caption =
    `💳 <b>Pembayaran QRIS ${res.orderNo}</b>\n\n` +
    `💰 Top Up Saldo: ${rupiah(res.baseAmount)}\n` +
    `🔢 Kode Unik: ${rupiah(uniqueCode)}\n` +
    `💳 Total Pembayaran: <b>${rupiah(res.amount)}</b>\n\n` +
    `⏱️ Berlaku selama ${mins} menit\n` +
    `✨ Saldo otomatis bertambah setelah lunas.`;
  const kb = new InlineKeyboard()
    .text('� Cek Status', `tu:check:${res.orderNo}`).row()
    .text('🔴 Batalkan', `tu:cancel:${res.orderNo}`).row()
    .text('💰 Saldo Saya', 'menu:saldo');

  if (res.qrisData) {
    try { await ctx.deleteMessage(); } catch {}
    let sent;
    try {
      const card = await buildQrisCard({
        qrisData: res.qrisData,
        title: 'Top Up Saldo',
        orderNo: res.orderNo,
        amount: res.amount,
        subtitle: `Saldo masuk: ${rupiah(res.baseAmount)}`,
      });
      sent = await ctx.replyWithPhoto(new InputFile(card, `qris-${res.orderNo}.png`), { caption, parse_mode: 'HTML', reply_markup: kb });
    } catch (e) {
      console.error('[topup qris card]', e.message);
      sent = await ctx.reply(caption + '\n\n⚠️ Gagal membuat gambar QRIS.', { parse_mode: 'HTML', reply_markup: kb });
    }
    if (ctx.session) ctx.session.lastBotMsgId = sent.message_id;
    scheduleTopupExpiry(ctx, res.orderNo, sent.message_id, res.expiresAt);
    return sent;
  }
  return editOrReply(ctx, caption + '\n\n⚠️ QRIS belum dikonfigurasi. Hubungi admin.', { reply_markup: kb });
}

/* When a top-up QRIS expires and is still unpaid: delete the QR message, send a
   fresh "expired" notice, and reopen the main menu. Best-effort. */
function scheduleTopupExpiry(ctx, orderNo, messageId, expiresAt) {
  const chatId = ctx.chat && ctx.chat.id;
  if (!chatId || !expiresAt) return;
  const ms = new Date(expiresAt).getTime() - Date.now();
  const delay = Math.max(1000, Math.min(ms + 1500, 60 * 60 * 1000));
  setTimeout(async () => {
    try {
      const r = await query("SELECT id, payment_status FROM orders WHERE order_no = $1 AND order_kind = 'topup'", [orderNo]);
      if (!r.rows.length) return;
      const o = r.rows[0];
      if (String(o.payment_status).toLowerCase() === 'paid') return;
      await query("UPDATE orders SET status='expired', payment_status='expired', updated_at=now() WHERE id=$1 AND payment_status NOT IN ('paid')", [o.id]);
      try { await ctx.api.deleteMessage(chatId, messageId); } catch {}
      const kb = new InlineKeyboard().text('🛍️ Menu Utama', 'menu:products');
      await ctx.api.sendMessage(chatId,
        `⌛ <b>QRIS kedaluwarsa</b>\n` +
        `Order: <code>${orderNo}</code>\n\n` +
        `Waktu pembayaran habis dan top up dibatalkan otomatis. Silakan coba lagi ya. 🙏`,
        { parse_mode: 'HTML', reply_markup: kb });
    } catch (e) { console.error('[topup qr expiry]', e.message); }
  }, delay).unref?.();
}

async function checkTopupStatus(ctx, orderNo) {
  const r = await query(
    "SELECT id, payment_status, user_id FROM orders WHERE order_no = $1 AND order_kind = 'topup'",
    [orderNo]
  );
  if (!r.rows.length) { try { await ctx.answerCallbackQuery({ text: 'Order tidak ditemukan.' }); } catch {} return; }
  const o = r.rows[0];
  if (String(o.payment_status).toLowerCase() === 'paid') {
    try { await ctx.answerCallbackQuery({ text: '✅ Pembayaran diterima!' }); } catch {}
    const balance = await wallet.getBalance(o.user_id);
    const kb = new InlineKeyboard()
      .text('🛍️ Lanjut Belanja', 'menu:products').row()
      .text('💰 Saldo Saya', 'menu:saldo');
    try { await ctx.deleteMessage(); } catch {}
    return replyClean(ctx,
      `✅ <b>Top up berhasil!</b>\nSaldo kamu sekarang: <b>${rupiah(balance)}</b>`, { reply_markup: kb });
  }
  const expired = String(o.payment_status).toLowerCase() === 'expired';
  if (expired) {
    try { await ctx.answerCallbackQuery({ text: 'Top up kedaluwarsa.' }); } catch {}
    try { await ctx.deleteMessage(); } catch {}
    const kb = new InlineKeyboard().text('🛍️ Menu Utama', 'menu:products');
    return replyClean(ctx,
      `⌛ <b>QRIS kedaluwarsa</b>\n` +
      `Order: <code>${orderNo}</code>\n\n` +
      `Waktu pembayaran sudah habis. Silakan coba lagi ya. 🙏`,
      { reply_markup: kb });
  }
  try {
    await ctx.answerCallbackQuery({
      text: '⏳ Belum ada pembayaran masuk. Coba lagi sebentar.',
      show_alert: true,
    });
  } catch {}
}

function registerTopupHandlers(bot, opts = {}) {
  bot.command('saldo', (ctx) => renderSaldo(ctx, opts));
  bot.command('topup', (ctx) => renderSaldo(ctx, opts));
  bot.hears('💰 Saldo', (ctx) => renderSaldo(ctx, opts));
  bot.hears('💰 Top Up', (ctx) => renderSaldo(ctx, opts));
  bot.callbackQuery('menu:saldo', async (ctx) => { await ctx.answerCallbackQuery(); return renderSaldo(ctx, opts); });

  bot.callbackQuery(/^tu:amt:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Membuat QRIS…' });
    if (ctx.session) ctx.session.awaitingTopupAmount = false;
    return createAndShowTopupQris(ctx, Number(ctx.match[1]));
  });

  bot.callbackQuery(/^tu:cancel:(.+)$/, async (ctx) => {
    const orderNo = ctx.match[1];
    const r = await query("SELECT id, payment_status FROM orders WHERE order_no = $1 AND order_kind = 'topup'", [orderNo]);
    if (!r.rows.length) { try { await ctx.answerCallbackQuery({ text: 'Order tidak ditemukan.' }); } catch {} return; }
    if (String(r.rows[0].payment_status).toLowerCase() === 'paid') {
      try { await ctx.answerCallbackQuery({ text: 'Top up ini sudah dibayar.', show_alert: true }); } catch {}
      return;
    }
    try {
      await query("UPDATE orders SET status='cancelled', payment_status='expired', updated_at=now() WHERE id=$1 AND payment_status NOT IN ('paid')", [r.rows[0].id]);
    } catch (e) { console.error('[topup cancel]', e.message); }
    try { await ctx.answerCallbackQuery({ text: '❌ Top up dibatalkan.' }); } catch {}
    try { await ctx.deleteMessage(); } catch {}
    return showProductList(ctx, 0);
  });

  // Custom amount: prompt the user to type a number.
  bot.callbackQuery('tu:custom', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.session) ctx.session = {};
    ctx.session.awaitingTopupAmount = true;
    return editOrReply(ctx,
      '✏️ <b>Top Up Nominal Lain</b>\n\n' +
      'Ketik nominal yang ingin kamu top up (minimal Rp1.000).\n' +
      'Contoh: <code>35000</code>');
  });

  // Capture a typed number when awaiting a custom top-up amount.
  bot.hears(/^\s*(?:rp\s*)?[\d.,]+\s*$/i, async (ctx, next) => {
    if (!ctx.session || !ctx.session.awaitingTopupAmount) return typeof next === 'function' ? next() : undefined;
    const digits = String(ctx.message.text || '').replace(/[^\d]/g, '');
    const amount = Number(digits);
    if (!Number.isFinite(amount) || amount < 1000) {
      return replyClean(ctx, '⚠️ Nominal tidak valid. Minimal Rp1.000. Ketik lagi, contoh: <code>35000</code>');
    }
    ctx.session.awaitingTopupAmount = false;
    return createAndShowTopupQris(ctx, amount);
  });

  bot.callbackQuery(/^tu:check:(.+)$/, async (ctx) => {
    return checkTopupStatus(ctx, ctx.match[1]);
  });
}

module.exports = { registerTopupHandlers, renderSaldo };
