'use strict';
/* Placeholder handlers for V2 menu buttons whose backend isn't built yet.
   Keeps the V2 keyboard layout identical while showing a friendly notice. */
const { replyClean } = require('./_reply');

function registerComingSoonHandlers(bot) {
  const soon = (title) => (ctx) => replyClean(ctx,
    `${title}\n\nFitur ini sedang disiapkan dan akan segera hadir. 🙏\n` +
    'Sementara ini, gunakan 📦 Daftar Produk untuk mulai belanja.'
  );

  bot.hears('🎟️ Voucher', soon('🎟️ <b>Voucher</b>'));
  bot.hears('💸 Tarik Saldo', soon('💸 <b>Tarik Saldo</b>'));
}

module.exports = { registerComingSoonHandlers };
