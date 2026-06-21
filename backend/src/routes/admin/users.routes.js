'use strict';
/* Admin user management. Mounted under /api/admin (auth enforced upstream).
   - list/search users with balance + spend
   - user detail with wallet transactions
   - manual balance credit/debit (adjustment)
   - ban / unban (is_active) */
const express = require('express');
const { query, tx } = require('../../db');
const wallet = require('../../wallet.service');

const router = express.Router();

/* GET /api/admin/users?q=&channel=&limit=&offset=  — search + filter + list. */
router.get('/users', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const channel = String(req.query.channel || '').trim().toLowerCase();
    const validChannels = ['web', 'miniapp', 'telegram'];
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    // Per-user channel = the channel of their most recent order.
    const lastChannel = `(SELECT o.channel FROM orders o WHERE o.user_id = u.id ORDER BY o.created_at DESC LIMIT 1)`;

    const params = [];
    let where = "WHERE u.role = 'buyer'";
    if (q) {
      params.push('%' + q + '%');
      where += ` AND (u.name ILIKE $${params.length} OR u.email ILIKE $${params.length}
                  OR u.telegram_username ILIKE $${params.length} OR CAST(u.telegram_id AS TEXT) ILIKE $${params.length})`;
    }
    if (validChannels.includes(channel)) {
      params.push(channel);
      where += ` AND ${lastChannel} = $${params.length}`;
    }

    const listParams = params.slice();
    listParams.push(limit); const lp = listParams.length;
    listParams.push(offset); const op = listParams.length;
    const r = await query(
      `SELECT u.id, u.name, u.email, u.telegram_id, u.telegram_username, u.is_active, u.created_at,
              COALESCE(w.balance, 0) AS balance,
              COALESCE((SELECT SUM(o.total_amount) FROM orders o
                         WHERE o.user_id = u.id AND o.payment_status = 'paid' AND o.order_kind = 'product'), 0) AS spend,
              ${lastChannel} AS channel
         FROM users u
         LEFT JOIN wallet_accounts w ON w.user_id = u.id
         ${where}
         ORDER BY u.created_at DESC
         LIMIT $${lp} OFFSET $${op}`,
      listParams
    );
    const c = await query(`SELECT count(*)::int AS n FROM users u ${where}`, params);
    res.json({ success: true, data: r.rows, total: c.rows[0].n, limit, offset });
  } catch (e) {
    console.error('[users list]', e);
    res.status(500).json({ success: false, message: 'Gagal memuat user.' });
  }
});

/* GET /api/admin/users/:id — detail with balance, spend, recent transactions. */
router.get('/users/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const u = await query(
      `SELECT u.id, u.name, u.email, u.phone, u.telegram_id, u.telegram_username,
              u.is_active, u.referral_code, u.created_at,
              COALESCE(w.balance, 0) AS balance
         FROM users u LEFT JOIN wallet_accounts w ON w.user_id = u.id
        WHERE u.id = $1`,
      [id]
    );
    if (!u.rows.length) return res.status(404).json({ success: false, message: 'User tidak ditemukan.' });

    const spend = await query(
      `SELECT COALESCE(SUM(total_amount), 0) AS total, count(*)::int AS orders
         FROM orders WHERE user_id = $1 AND payment_status = 'paid' AND order_kind = 'product'`,
      [id]
    );
    const topup = await query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM wallet_transactions
        WHERE user_id = $1 AND type = 'topup'`,
      [id]
    );
    const txns = await query(
      `SELECT id, type, amount, balance_after, note, created_at
         FROM wallet_transactions WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 50`,
      [id]
    );
    res.json({
      success: true,
      data: {
        user: u.rows[0],
        spend: Number(spend.rows[0].total),
        spendOrders: Number(spend.rows[0].orders),
        topupTotal: Number(topup.rows[0].total),
        transactions: txns.rows,
      },
    });
  } catch (e) {
    console.error('[user detail]', e);
    res.status(500).json({ success: false, message: 'Gagal memuat detail user.' });
  }
});

/* POST /api/admin/users/:id/balance — manual credit/debit.
   body: { amount: number (+/-), note?: string } */
router.post('/users/:id/balance', async (req, res) => {
  try {
    const id = req.params.id;
    const amount = Math.round(Number(req.body && req.body.amount));
    const note = String((req.body && req.body.note) || '').trim() || 'Penyesuaian saldo oleh admin';
    if (!Number.isFinite(amount) || amount === 0) {
      return res.status(400).json({ success: false, message: 'Nominal harus angka bukan nol (boleh negatif).' });
    }
    const exists = await query("SELECT 1 FROM users WHERE id = $1", [id]);
    if (!exists.rows.length) return res.status(404).json({ success: false, message: 'User tidak ditemukan.' });

    let balance;
    try {
      balance = await tx(async (client) => wallet.adjust(client, {
        userId: id, type: 'adjustment', amount, refOrderId: null, note,
      }));
    } catch (e) {
      if (e.message === 'INSUFFICIENT_BALANCE') {
        return res.status(400).json({ success: false, message: 'Saldo tidak cukup untuk pengurangan ini.' });
      }
      throw e;
    }
    res.json({ success: true, data: { balance } });
  } catch (e) {
    console.error('[user balance]', e);
    res.status(500).json({ success: false, message: e.message || 'Gagal menyesuaikan saldo.' });
  }
});

/* POST /api/admin/users/:id/message — send a Telegram message to the user.
   body: { text: string } */
router.post('/users/:id/message', async (req, res) => {
  try {
    const id = req.params.id;
    const text = String((req.body && req.body.text) || '').trim();
    if (!text) return res.status(400).json({ success: false, message: 'Pesan tidak boleh kosong.' });
    if (text.length > 4000) return res.status(400).json({ success: false, message: 'Pesan maksimal 4000 karakter.' });
    const u = await query("SELECT telegram_id FROM users WHERE id = $1", [id]);
    if (!u.rows.length) return res.status(404).json({ success: false, message: 'User tidak ditemukan.' });
    if (!u.rows[0].telegram_id) {
      return res.status(400).json({ success: false, message: 'User ini tidak terhubung ke Telegram.' });
    }
    const loader = require('../../telegram/bot-loader');
    try {
      await loader.sendMessage(String(u.rows[0].telegram_id), text, { parse_mode: 'HTML' });
    } catch (e) {
      return res.status(502).json({ success: false, message: 'Gagal mengirim: ' + e.message });
    }
    res.json({ success: true });
  } catch (e) {
    console.error('[user message]', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

/* PUT /api/admin/users/:id/active — ban/unban. body: { active: bool } */
router.put('/users/:id/active', async (req, res) => {
  try {
    const id = req.params.id;
    const active = !!(req.body && req.body.active);
    const r = await query(
      "UPDATE users SET is_active = $2, updated_at = now() WHERE id = $1 RETURNING id, is_active",
      [id, active]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'User tidak ditemukan.' });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    console.error('[user active]', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
