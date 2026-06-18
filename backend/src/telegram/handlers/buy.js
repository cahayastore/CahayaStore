'use strict';
/* ════════════════════════════════════════════════════════════════════
   In-bot buy flow (no mini app). Flow stays inside the Telegram chat:
     Beli Sekarang → pilih jumlah → buat order → tampilkan QRIS →
     cek status → (kredensial dikirim otomatis saat lunas via webhook).
   Identity = ctx.from (the Telegram user), so the order + credential
   delivery always belong to the buyer who pressed the button.
   ════════════════════════════════════════════════════════════════════ */
const { InlineKeyboard, InputFile } = require('grammy');
const { query } = require('../../db');
const { escapeHtml, rupiah, ensureTelegramUser } = require('./_shared');
const { editOrReply, replyClean, replyEphemeral } = require('./_reply');
const { createOrderForCustomer } = require('../../checkout.service');
const { buildQrisCard } = require('../../qris-card.service');
const { showProductList } = require('./v3-menu');

const MAX_QTY = 100;

async function fetchProduct(productId) {
  const r = await query(
    `SELECT p.id, p.name, p.slug, p.price, p.warranty_enabled, p.warranty_label,
            count(s.id) FILTER (WHERE s.status='available') AS stock
       FROM products p
       LEFT JOIN product_stocks s ON s.product_id = p.id
      WHERE p.id = $1 AND p.is_active = TRUE
      GROUP BY p.id`,
    [productId]
  );
  return r.rows[0] || null;
}

/* Step 1: quantity selector for a product. */
async function showQtySelector(ctx, productId, qty) {
  const p = await fetchProduct(productId);
  if (!p) return editOrReply(ctx, 'Produk tidak ditemukan.');
  const stock = Number(p.stock);
  if (stock <= 0) {
    const kb = new InlineKeyboard().text('← Kembali', `v3:p:${productId}`);
    return editOrReply(ctx, `🛍️ <b>${escapeHtml(p.name)}</b>\n\n❌ Stok habis.`, { reply_markup: kb });
  }
  const maxQty = Math.max(1, Math.min(MAX_QTY, stock));
  const q = Math.max(1, Math.min(maxQty, Number(qty) || 1));
  const subtotal = Number(p.price) * q;
  const text =
    `🛒 <b>${escapeHtml(p.name)}</b>\n` +
    `Harga: <b>${rupiah(p.price)}</b>\n` +
    `Stok tersedia: ${stock}\n\n` +
    `Jumlah: <b>${q}</b>\n` +
    `Subtotal: <b>${rupiah(subtotal)}</b>`;
  const kb = new InlineKeyboard()
    .text('➖', `v3:qty:${productId}:${Math.max(1, q - 1)}`)
    .text(`${q}`, 'v3:noop')
    .text('➕', `v3:qty:${productId}:${Math.min(maxQty, q + 1)}`).row()
    .text(`✅ Buat Pesanan (${rupiah(subtotal)})`, `v3:order:${productId}:${q}`).row()
    .text('← Kembali', `v3:p:${productId}`);
  return editOrReply(ctx, text, { reply_markup: kb });
}

/* Step 2: create order + show QRIS. */
async function createAndShowQris(ctx, productId, qty) {
  const p = await fetchProduct(productId);
  if (!p) return editOrReply(ctx, 'Produk tidak ditemukan.');
  const stock = Number(p.stock);
  if (stock <= 0) return editOrReply(ctx, '❌ Stok habis.');
  const q = Math.max(1, Math.min(Math.min(MAX_QTY, stock), Number(qty) || 1));

  // Resolve the Telegram user as the order customer (has telegram_id).
  let user = null;
  try { user = await ensureTelegramUser(ctx.from); } catch (e) { console.error('[v3 buy ensureUser]', e.message); }
  if (!user || !user.id) return editOrReply(ctx, 'Gagal memproses akun. Coba /start dulu.');

  // Give the order a recognizable email when none exists.
  const handle = ctx.from && ctx.from.username
    ? String(ctx.from.username).toLowerCase().replace(/[^a-z0-9_]/g, '')
    : '';
  const email = user.email || (handle ? `${handle}@telegram.cahayastore.me` : `tg${ctx.from.id}@telegram.cahayastore.me`);

  let res;
  try {
    res = await createOrderForCustomer({
      customer: { id: user.id, email },
      items: [{ productId: p.id, quantity: q }],
      channel: 'telegram',
    });
  } catch (e) {
    console.error('[v3 buy createOrder]', e.message);
    return editOrReply(ctx, `Gagal membuat pesanan: ${escapeHtml(e.message)}`);
  }

  const baseTotal = Number(p.price) * q;
  const uniqueCode = Math.max(0, Number(res.amount) - baseTotal);
  const mins = Math.max(1, Math.round((new Date(res.expiresAt).getTime() - Date.now()) / 60000));
  const caption =
    `💳 <b>Pembayaran QRIS ${escapeHtml(res.orderNo)}</b>\n\n` +
    `📦 Produk: ${escapeHtml(p.name)} x${q}\n` +
    `💰 Total: ${rupiah(baseTotal)}\n` +
    `🔢 Kode Unik: ${rupiah(uniqueCode)}\n` +
    `💳 Total Pembayaran: <b>${rupiah(res.amount)}</b>\n\n` +
    `⏱️ Berlaku selama ${mins} menit\n` +
    `✨ Pembayaran akan otomatis terdeteksi.`;
  const kb = new InlineKeyboard()
    .text('🔄 Cek Status Pembayaran', `v3:check:${res.orderNo}`).row()
    .text('❌ Batalkan Pesanan', `v3:cancel:${res.orderNo}`).row()
    .text('☰ Pesanan Saya', 'v3:orders');

  if (res.qrisData) {
    // Replace the current screen with a photo message (QRIS).
    try { await ctx.deleteMessage(); } catch {}
    let sent;
    try {
      const card = await buildQrisCard({
        qrisData: res.qrisData,
        title: 'Pembayaran QRIS',
        orderNo: res.orderNo,
        amount: res.amount,
        subtitle: `${p.name} × ${q}`,
      });
      sent = await ctx.replyWithPhoto(new InputFile(card, `qris-${res.orderNo}.png`), { caption, parse_mode: 'HTML', reply_markup: kb });
    } catch (e) {
      console.error('[buy qris card]', e.message);
      sent = await ctx.reply(caption + '\n\n⚠️ Gagal membuat gambar QRIS.', { parse_mode: 'HTML', reply_markup: kb });
    }
    if (ctx.session) ctx.session.lastBotMsgId = sent.message_id;
    scheduleQrExpiry(ctx, res.orderNo, sent.message_id, res.expiresAt);
    return sent;
  }
  // QRIS not configured — show text fallback.
  return editOrReply(ctx,
    caption + '\n\n⚠️ QRIS belum dikonfigurasi. Hubungi admin.', { reply_markup: kb });
}

/* When a QRIS expires and the order is still unpaid: delete the QR message,
   send a fresh "expired" notice, release reserved stock, and reopen the menu.
   Best-effort; works in webhook mode using ctx.api + the chat id. */
function scheduleQrExpiry(ctx, orderNo, messageId, expiresAt) {
  const chatId = ctx.chat && ctx.chat.id;
  if (!chatId || !expiresAt) return;
  const ms = new Date(expiresAt).getTime() - Date.now();
  // Cap the timer so a far-future/invalid value can't hang; min 1s.
  const delay = Math.max(1000, Math.min(ms + 1500, 60 * 60 * 1000));
  setTimeout(async () => {
    try {
      const r = await query("SELECT id, payment_status FROM orders WHERE order_no = $1", [orderNo]);
      if (!r.rows.length) return;
      const o = r.rows[0];
      if (String(o.payment_status).toLowerCase() === 'paid') return; // already paid — leave it
      // Mark expired + release reserved stock.
      await query(
        "UPDATE orders SET status='expired', payment_status='expired', updated_at=now() WHERE id=$1 AND payment_status NOT IN ('paid')",
        [o.id]
      );
      await query(
        "UPDATE product_stocks SET status='available', reserved_until=NULL, reserved_order_id=NULL WHERE reserved_order_id=$1 AND status IN ('available','reserved')",
        [o.id]
      );
      try { await ctx.api.deleteMessage(chatId, messageId); } catch {}
      const kb = new InlineKeyboard().text('🛍️ Menu Utama', 'menu:products');
      await ctx.api.sendMessage(chatId,
        `⌛ <b>QRIS kedaluwarsa</b>\n` +
        `Order: <code>${escapeHtml(orderNo)}</code>\n\n` +
        `Waktu pembayaran habis dan pesanan dibatalkan otomatis. Silakan pesan lagi ya. 🙏`,
        { parse_mode: 'HTML', reply_markup: kb });
    } catch (e) { console.error('[buy qr expiry]', e.message); }
  }, delay).unref?.();
}


/* Cancel a pending order: mark expired/cancelled, release reserved stock, then
   open the main product menu. No-op if already paid. */
async function cancelOrder(ctx, orderNo) {
  const r = await query(
    "SELECT id, payment_status FROM orders WHERE order_no = $1",
    [orderNo]
  );
  if (!r.rows.length) { try { await ctx.answerCallbackQuery({ text: 'Order tidak ditemukan.' }); } catch {} return; }
  const o = r.rows[0];
  if (String(o.payment_status).toLowerCase() === 'paid') {
    try { await ctx.answerCallbackQuery({ text: 'Pesanan ini sudah dibayar.', show_alert: true }); } catch {}
    return;
  }
  try {
    await query(
      "UPDATE orders SET status='cancelled', payment_status='expired', updated_at=now() WHERE id=$1 AND payment_status NOT IN ('paid')",
      [o.id]
    );
    // Release any stock reserved for this order back to available.
    await query(
      "UPDATE product_stocks SET status='available', reserved_until=NULL, reserved_order_id=NULL WHERE reserved_order_id=$1 AND status IN ('available','reserved')",
      [o.id]
    );
  } catch (e) { console.error('[buy cancel]', e.message); }
  try { await ctx.answerCallbackQuery({ text: '❌ Pesanan dibatalkan.' }); } catch {}
  try { await ctx.deleteMessage(); } catch {}
  return showProductList(ctx, 0);
}

/* Step 3: check payment status. */
async function checkStatus(ctx, orderNo) {
  const r = await query(
    `SELECT o.id, o.payment_status, o.status,
            (SELECT count(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.delivered_stock_id IS NOT NULL) AS delivered
       FROM orders o WHERE o.order_no = $1`,
    [orderNo]
  );
  if (!r.rows.length) { try { await ctx.answerCallbackQuery({ text: 'Order tidak ditemukan.' }); } catch {} return; }
  const o = r.rows[0];
  const paid = String(o.payment_status).toLowerCase() === 'paid';
  if (paid) {
    try { await ctx.answerCallbackQuery({ text: '✅ Pembayaran diterima!' }); } catch {}
    // Credentials are delivered automatically by the payment webhook. Show a
    // confirmation screen here. (If webhook hasn't run yet, the credential
    // message will still arrive shortly.)
    const text =
      `✅ <b>Pembayaran berhasil!</b>\n` +
      `Order: <code>${escapeHtml(orderNo)}</code>\n\n` +
      `Produk sedang dikirim ke chat ini. Cek pesan berikutnya. 🙏`;
    const kb = new InlineKeyboard()
      .text('🛍️ Lanjut Belanja', 'menu:products').row()
      .text('☰ Pesanan Saya', 'v3:orders');
    try { await ctx.deleteMessage(); } catch {}
    return replyClean(ctx, text, { reply_markup: kb });
  }
  const expired = String(o.payment_status).toLowerCase() === 'expired' || String(o.status).toLowerCase() === 'expired';
  if (expired) {
    try { await ctx.answerCallbackQuery({ text: 'Pesanan kedaluwarsa.' }); } catch {}
    try { await ctx.deleteMessage(); } catch {}
    const kb = new InlineKeyboard().text('🛍️ Menu Utama', 'menu:products');
    return replyClean(ctx,
      `⌛ <b>QRIS kedaluwarsa</b>\n` +
      `Order: <code>${escapeHtml(orderNo)}</code>\n\n` +
      `Waktu pembayaran sudah habis. Silakan pesan lagi ya. 🙏`,
      { reply_markup: kb });
  }
  try {
    await ctx.answerCallbackQuery({
      text: '⏳ Belum ada pembayaran masuk. Coba lagi sebentar.',
      show_alert: true,
    });
  } catch {}
}

function registerBuyHandlers(bot) {
  bot.callbackQuery('v3:noop', async (ctx) => { try { await ctx.answerCallbackQuery(); } catch {} });

  bot.callbackQuery(/^v3:buy:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    return showQtySelector(ctx, ctx.match[1], 1);
  });
  bot.callbackQuery(/^v3:qty:([^:]+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    return showQtySelector(ctx, ctx.match[1], Number(ctx.match[2]));
  });
  bot.callbackQuery(/^v3:order:([^:]+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Membuat pesanan…' });
    return createAndShowQris(ctx, ctx.match[1], Number(ctx.match[2]));
  });
  bot.callbackQuery(/^v3:check:(.+)$/, async (ctx) => {
    return checkStatus(ctx, ctx.match[1]);
  });
  bot.callbackQuery(/^v3:cancel:(.+)$/, async (ctx) => {
    return cancelOrder(ctx, ctx.match[1]);
  });
}

module.exports = { registerBuyHandlers };
