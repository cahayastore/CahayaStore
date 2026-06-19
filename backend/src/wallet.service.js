'use strict';
/* Wallet service — balance + append-only ledger + referral payout.
   All mutations go through a transaction; balance_after is recorded per entry. */
const { query, tx } = require('./db');

const REFERRAL_BONUS = Number(process.env.REFERRAL_BONUS) || 2000;

async function ensureWallet(userId, client = null) {
  const q = client ? client.query.bind(client) : query;
  await q(
    `INSERT INTO wallet_accounts (user_id, balance) VALUES ($1, 0)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

async function getBalance(userId) {
  const r = await query('SELECT balance FROM wallet_accounts WHERE user_id = $1', [userId]);
  return r.rows.length ? Number(r.rows[0].balance) : 0;
}

async function listTransactions(userId, limit = 10) {
  const r = await query(
    `SELECT type, amount, balance_after, status, note, created_at
       FROM wallet_transactions WHERE user_id = $1
      ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return r.rows;
}

/* Credit (positive) or debit (negative) the wallet inside a transaction. */
async function adjust(client, { userId, type, amount, refOrderId = null, note = null }) {
  await ensureWallet(userId, client);
  const locked = await client.query(
    'SELECT balance FROM wallet_accounts WHERE user_id = $1 FOR UPDATE',
    [userId]
  );
  const current = Number(locked.rows[0].balance);
  const next = current + Number(amount);
  if (next < 0) throw new Error('INSUFFICIENT_BALANCE');
  await client.query(
    'UPDATE wallet_accounts SET balance = $2, updated_at = now() WHERE user_id = $1',
    [userId, next]
  );
  await client.query(
    `INSERT INTO wallet_transactions (user_id, type, amount, balance_after, ref_order_id, status, note)
     VALUES ($1, $2, $3, $4, $5, 'completed', $6)`,
    [userId, type, amount, next, refOrderId, note]
  );
  return next;
}

/* Credit a topup order's amount to the buyer's wallet (idempotent per order). */
async function creditTopup(orderId) {
  return tx(async (client) => {
    const o = await client.query(
      "SELECT id, user_id, total_amount, order_kind FROM orders WHERE id = $1 FOR UPDATE",
      [orderId]
    );
    if (!o.rows.length) return { ok: false, reason: 'no_order' };
    const order = o.rows[0];
    if (order.order_kind !== 'topup' || !order.user_id) return { ok: false, reason: 'not_topup' };
    const dup = await client.query(
      "SELECT 1 FROM wallet_transactions WHERE ref_order_id = $1 AND type = 'topup'",
      [orderId]
    );
    if (dup.rows.length) return { ok: true, already: true };
    const base = Number(order.total_amount);
    let balance = await adjust(client, {
      userId: order.user_id, type: 'topup', amount: base,
      refOrderId: orderId, note: 'Top up saldo',
    });

    // Apply a configurable top-up bonus: free balance when the top-up reaches a
    // certain nominal. Tiers are { min, bonus }; the highest matching tier wins.
    try {
      const { getSetting, KEYS } = require('./settings.service');
      const cfg = await getSetting(KEYS.TOPUP_BONUS);
      if (cfg && cfg.enabled && Array.isArray(cfg.tiers) && cfg.tiers.length) {
        const eligible = cfg.tiers
          .map((t) => ({ min: Number(t.min) || 0, bonus: Math.round(Number(t.bonus) || 0) }))
          .filter((t) => t.bonus > 0 && base >= t.min)
          .sort((a, b) => b.min - a.min);
        if (eligible.length) {
          const { min, bonus } = eligible[0];
          balance = await adjust(client, {
            userId: order.user_id, type: 'adjustment', amount: bonus,
            refOrderId: orderId, note: `Bonus top up (≥ ${min})`,
          });
        }
      }
    } catch (e) { console.error('[topup bonus]', e.message); }

    return { ok: true, balance };
  });
}

/* Pay out a referral bonus when a referred user completes their first paid order. */
async function payReferralBonus(orderId) {
  return tx(async (client) => {
    const o = await client.query(
      'SELECT id, user_id FROM orders WHERE id = $1',
      [orderId]
    );
    if (!o.rows.length || !o.rows[0].user_id) return { ok: false, reason: 'no_user' };
    const buyerId = o.rows[0].user_id;

    const u = await client.query('SELECT referred_by FROM users WHERE id = $1', [buyerId]);
    const referrerId = u.rows[0]?.referred_by;
    if (!referrerId) return { ok: false, reason: 'no_referrer' };

    // One payout per referred user (UNIQUE(referred_id)).
    const dup = await client.query('SELECT 1 FROM referrals WHERE referred_id = $1', [buyerId]);
    if (dup.rows.length) return { ok: true, already: true };

    await client.query(
      `INSERT INTO referrals (referrer_id, referred_id, bonus_amount, ref_order_id)
       VALUES ($1, $2, $3, $4)`,
      [referrerId, buyerId, REFERRAL_BONUS, orderId]
    );
    const balance = await adjust(client, {
      userId: referrerId, type: 'referral_bonus', amount: REFERRAL_BONUS,
      refOrderId: orderId, note: 'Bonus referral',
    });
    return { ok: true, referrerId, bonus: REFERRAL_BONUS, balance };
  });
}

module.exports = {
  REFERRAL_BONUS, ensureWallet, getBalance, listTransactions, adjust,
  creditTopup, payReferralBonus,
};
