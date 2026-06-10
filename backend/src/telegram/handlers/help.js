'use strict';

function registerHelpHandlers(bot) {
  const help = (ctx) => ctx.reply(
    'ℹ️ <b>Bantuan Cahaya Store</b>\n\n' +
    '/start — buka menu utama & toko\n' +
    '/products — lihat katalog\n' +
    '/kategori — telusuri kategori\n' +
    '/orders — riwayat pesanan\n' +
    '/saldo — cek saldo & top up\n' +
    '/referral — undang teman, dapat bonus\n' +
    '/profil — profil akun\n\n' +
    'Pembayaran QRIS, produk dikirim instan setelah lunas.',
    { parse_mode: 'HTML' }
  );
  bot.command('bantuan', help);
  bot.command('help', help);
  bot.callbackQuery('menu:help', async (ctx) => { await ctx.answerCallbackQuery(); return help(ctx); });
}

module.exports = { registerHelpHandlers };
