'use strict';
/* ════════════════════════════════════════════════════════════════════
   Reply & clean — centralized message sender for the bot.
   Keeps the chat tidy by deleting the previous bot screen before sending
   a new one (like Marketku's single-screen UX). Tracks the last message
   id per chat in ctx.session.lastBotMsgId.

   Usage in any handler:
     const { replyClean, editOrReply } = require('./_reply');
     await replyClean(ctx, text, { reply_markup });
     await editOrReply(ctx, text, { reply_markup });   // edits on callback
   ════════════════════════════════════════════════════════════════════ */

function getSession(ctx) {
  if (!ctx.session) ctx.session = {};
  return ctx.session;
}

/* Delete the previously tracked bot message (best-effort). */
async function clearLast(ctx) {
  const s = getSession(ctx);
  const chatId = ctx.chat?.id;
  if (chatId && s.lastBotMsgId) {
    const id = s.lastBotMsgId;
    s.lastBotMsgId = null;
    try { await ctx.api.deleteMessage(chatId, id); } catch { /* already gone */ }
  }
}

/* Send a fresh message, deleting the previous bot screen first. Tracks the new id. */
async function replyClean(ctx, text, opts = {}) {
  await clearLast(ctx);
  const sent = await ctx.reply(text, { parse_mode: 'HTML', ...opts });
  getSession(ctx).lastBotMsgId = sent.message_id;
  return sent;
}

/* On a callback, edit the current message in place; otherwise reply clean.
   Falls back to replyClean if the edit fails (e.g. message too old/identical). */
async function editOrReply(ctx, text, opts = {}) {
  if (ctx.callbackQuery && ctx.callbackQuery.message) {
    try {
      const edited = await ctx.editMessageText(text, { parse_mode: 'HTML', ...opts });
      // Keep tracking the edited message as the current screen.
      const msgId = ctx.callbackQuery.message.message_id;
      getSession(ctx).lastBotMsgId = msgId;
      return edited;
    } catch { /* fall through */ }
  }
  return replyClean(ctx, text, opts);
}

/* Send a transient message that is NOT tracked (e.g. credentials, ephemeral notes). */
async function replyEphemeral(ctx, text, opts = {}) {
  return ctx.reply(text, { parse_mode: 'HTML', ...opts });
}

module.exports = { replyClean, editOrReply, replyEphemeral, clearLast };
