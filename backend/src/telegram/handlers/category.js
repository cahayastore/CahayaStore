'use strict';
const { InlineKeyboard } = require('grammy');
const { query } = require('../../db');
const { escapeHtml } = require('./_shared');
const { replyClean, editOrReply } = require('./_reply');

async function renderCategories(ctx) {
  const r = await query(
    `SELECT c.name, c.slug, count(p.id) AS n
       FROM categories c
       LEFT JOIN products p ON p.category_id = c.id AND p.is_active = TRUE
      WHERE c.is_active = TRUE
      GROUP BY c.id
      ORDER BY c.name ASC
      LIMIT 30`
  );
  if (!r.rows.length) return ctx.reply('Belum ada kategori.');
  const kb = new InlineKeyboard();
  r.rows.forEach((c, i) => {
    kb.text(`${c.name} (${c.n})`, `cat:${c.slug}`);
    if (i % 2 === 1) kb.row();
  });
  await replyClean(ctx, '🗂️ <b>Kategori Produk</b>\nPilih kategori:', { reply_markup: kb });
}

function registerCategoryHandlers(bot) {
  bot.command('kategori', (ctx) => renderCategories(ctx));
  bot.hears('🗂️ Kategori', (ctx) => renderCategories(ctx));
  bot.callbackQuery('menu:categories', async (ctx) => { await ctx.answerCallbackQuery(); return renderCategories(ctx); });

  bot.callbackQuery(/^cat:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const slug = ctx.match[1];
    const r = await query(
      `SELECT p.name, p.slug, p.price FROM products p
         JOIN categories c ON c.id = p.category_id
        WHERE c.slug = $1 AND p.is_active = TRUE
        ORDER BY p.created_at DESC LIMIT 20`,
      [slug]
    );
    if (!r.rows.length) return ctx.reply('Belum ada produk di kategori ini.');
    const kb = new InlineKeyboard();
    r.rows.forEach((p) => {
      kb.text(`${p.name} — Rp${Number(p.price).toLocaleString('id-ID')}`, `prod:${p.slug}`).row();
    });
    await editOrReply(ctx, 'Produk dalam kategori:', { reply_markup: kb });
  });
}

module.exports = { registerCategoryHandlers, renderCategories };
