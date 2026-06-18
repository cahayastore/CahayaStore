'use strict';
const { InlineKeyboard, InputFile } = require('grammy');
const { ensureTelegramUser, rupiah } = require('./_shared');
const { replyClean, editOrReply } = require('./_reply');
const wallet = require('../../wallet.service');
const { createTopupOrder } = require('../../checkout.service');
const { query } = require('../../db');
const { buildQrisCard } = require('../../qris-card.service');
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

  const caption =
    `💰 <b>Top Up Saldo</b>\n` +
    `Order: <code>${res.orderNo}</code>\n` +
    `Nominal masuk saldo: <b>${rupiah(res.baseAmount)}</b>\n\n` +
    `💳 Bayar <b>TEPAT</b>: <code>${rupiah(res.amount)}</code>\n` +
    `<i>Nominal unik agar pembayaran terdeteksi otomatis. Bayar pas sampai digit terakhir.</i>\n\n` +
    `Scan QRIS di atas. Saldo otomatis bertambah setelah lunas.`;
  const kb = new InlineKeyboard()
    .text('🔄 Cek Status', `tu:check:${res.orderNo}`).row()
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
    return sent;
  }
  return editOrReply(ctx, caption + '\n\n⚠️ QRIS belum dikonfigurasi. Hubungi admin.', { reply_markup: kb });
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
    const kb = new InlineKeyboard().text('💰 Saldo Saya', 'menu:saldo').text('📦 Belanja', 'menu:products');
    try { await ctx.deleteMessage(); } catch {}
    return replyClean(ctx,
      `✅ <b>Top up berhasil!</b>\nSaldo kamu sekarang: <b>${rupiah(balance)}</b>`, { reply_markup: kb });
  }
  const expired = String(o.payment_status).toLowerCase() === 'expired';
  try {
    await ctx.answerCallbackQuery({
      text: expired ? 'Top up kedaluwarsa. Buat baru.' : '⏳ Belum ada pembayaran masuk. Coba lagi sebentar.',
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
