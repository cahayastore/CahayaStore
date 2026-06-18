'use strict';
/* Persistent broadcast service — jobs are stored in the broadcast_jobs table so
   they survive tab closes AND server restarts. A single in-process runner drives
   the active job, periodically persisting its cursor/progress. On startup,
   resumePending() picks up any job left in 'running' and continues from cursor. */
const { query } = require('./db');

let running = false; // single-flight guard within this process

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* Create a new job row + snapshot recipients, then kick off the runner. */
async function startJob({ text, imageUrl = null, voucherCode = null, parseMode = 'HTML' }) {
  const active = await getActive();
  if (active) { const e = new Error('Broadcast lain sedang berjalan.'); e.code = 'BUSY'; throw e; }

  const r = await query("SELECT DISTINCT telegram_id FROM users WHERE telegram_id IS NOT NULL");
  const recipients = r.rows.map((x) => String(x.telegram_id)).filter(Boolean);

  const ins = await query(
    `INSERT INTO broadcast_jobs (text, image_url, voucher_code, parse_mode, recipients, total, status)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,'running') RETURNING id, total, status`,
    [text || '', imageUrl, voucherCode, parseMode, JSON.stringify(recipients), recipients.length]
  );
  const job = ins.rows[0];
  // Drive in the background; do not await.
  runJob(job.id).catch((e) => console.error('[broadcast run]', e.message));
  return { id: job.id, total: job.total, status: job.status };
}

/* The active (running) job, or null. */
async function getActive() {
  const r = await query("SELECT * FROM broadcast_jobs WHERE status = 'running' ORDER BY created_at ASC LIMIT 1");
  return r.rows[0] || null;
}

/* Status of the most relevant job (running first, else most recent). */
async function getStatus() {
  let r = await query("SELECT * FROM broadcast_jobs WHERE status='running' ORDER BY created_at ASC LIMIT 1");
  if (!r.rows.length) r = await query("SELECT * FROM broadcast_jobs ORDER BY created_at DESC LIMIT 1");
  const j = r.rows[0];
  if (!j) return { status: 'idle' };
  return {
    id: String(j.id), status: j.status, total: j.total, sent: j.sent,
    failed: j.failed, startedAt: j.created_at, finishedAt: j.finished_at, error: j.error,
  };
}

/* Cancel the active job. */
async function cancel() {
  const r = await query("UPDATE broadcast_jobs SET status='cancelled', finished_at=now(), updated_at=now() WHERE status='running' RETURNING id");
  return { cancelled: r.rows.length > 0 };
}

/* Core loop: send from cursor → total, persisting progress every few sends. */
async function runJob(id) {
  if (running) return; // another loop already active in this process
  running = true;
  try {
    const { sendMessage, sendPhoto } = require('./telegram/bot-loader');
    const r0 = await query("SELECT * FROM broadcast_jobs WHERE id=$1", [id]);
    const job = r0.rows[0];
    if (!job || job.status !== 'running') return;

    const recipients = Array.isArray(job.recipients) ? job.recipients : JSON.parse(job.recipients || '[]');
    const parseMode = job.parse_mode === 'none' ? undefined : 'HTML';
    let reply_markup;
    if (job.voucher_code) {
      reply_markup = { inline_keyboard: [[{ text: '🎟️ Tukar Voucher Sekarang', callback_data: 'menu:voucher' }]] };
    }
    const opts = { parse_mode: parseMode, ...(reply_markup ? { reply_markup } : {}) };

    let sent = job.sent;
    let failed = job.failed;
    let i = job.cursor;
    let sinceFlush = 0;

    for (; i < recipients.length; i += 1) {
      // Re-check cancellation periodically.
      if (sinceFlush === 0) {
        const cur = await query("SELECT status FROM broadcast_jobs WHERE id=$1", [id]);
        if (!cur.rows.length || cur.rows[0].status !== 'running') return;
      }
      const chatId = recipients[i];
      try {
        if (job.image_url) await sendPhoto(chatId, job.image_url, job.text, opts);
        else await sendMessage(chatId, job.text, opts);
        sent += 1;
      } catch (e) {
        failed += 1;
        const after = e && e.parameters && e.parameters.retry_after;
        if (after) await sleep((Number(after) + 1) * 1000);
      }
      sinceFlush += 1;
      // Persist progress every 10 sends (cursor = next index to send).
      if (sinceFlush >= 10) {
        await query(
          "UPDATE broadcast_jobs SET sent=$2, failed=$3, cursor=$4, updated_at=now() WHERE id=$1",
          [id, sent, failed, i + 1]
        );
        sinceFlush = 0;
      }
      await sleep(50); // ~20 msg/sec
    }

    await query(
      "UPDATE broadcast_jobs SET sent=$2, failed=$3, cursor=$4, status='done', finished_at=now(), updated_at=now() WHERE id=$1 AND status='running'",
      [id, sent, failed, recipients.length]
    );
    try {
      await query(
        "INSERT INTO audit_logs (action, entity_type, entity_id, metadata) VALUES ('broadcast.sent','broadcast',NULL,$1)",
        [JSON.stringify({ id: String(id), total: recipients.length, sent, failed, image: !!job.image_url, voucher: job.voucher_code || null })]
      );
    } catch (e) { /* audit best-effort */ }
  } catch (e) {
    await query("UPDATE broadcast_jobs SET status='error', error=$2, finished_at=now(), updated_at=now() WHERE id=$1 AND status='running'", [id, e.message]).catch(() => {});
    console.error('[broadcast run]', e.message);
  } finally {
    running = false;
  }
}

/* On startup: resume any job left running (e.g. server restarted mid-send). */
async function resumePending() {
  try {
    const r = await query("SELECT id FROM broadcast_jobs WHERE status='running' ORDER BY created_at ASC LIMIT 1");
    if (r.rows.length) {
      const id = r.rows[0].id;
      console.log(`[broadcast] resuming job ${id} after restart`);
      runJob(id).catch((e) => console.error('[broadcast resume]', e.message));
    }
  } catch (e) {
    console.warn('[broadcast] resume check failed:', e.message);
  }
}

async function countRecipients() {
  const r = await query("SELECT count(*)::int AS n FROM users WHERE telegram_id IS NOT NULL");
  return r.rows[0].n;
}

module.exports = { startJob, getStatus, cancel, resumePending, countRecipients };
