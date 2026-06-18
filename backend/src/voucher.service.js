'use strict';
/* Voucher service — admin-created codes that users redeem for wallet balance.
   Redemption is atomic: locks the voucher row, enforces max_uses + per_user_limit
   + expiry + active, credits the wallet, and records a redemption. */
const { query, tx } = require('./db');
const wallet = require('./wallet.service');

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

/* Redeem a voucher code for a user. Returns { ok, amount, balance } or throws
   an Error with a `.code` describing the reason. */
async function redeemVoucher({ code, userId }) {
  const norm = normalizeCode(code);
  if (!norm) { const e = new Error('Kode voucher kosong.'); e.code = 'EMPTY'; throw e; }
  if (!userId) { const e = new Error('User tidak valid.'); e.code = 'NO_USER'; throw e; }

  return tx(async (client) => {
    const vr = await client.query(
      "SELECT * FROM vouchers WHERE lower(code) = lower($1) FOR UPDATE",
      [norm]
    );
    if (!vr.rows.length) { const e = new Error('Kode voucher tidak ditemukan.'); e.code = 'NOT_FOUND'; throw e; }
    const v = vr.rows[0];

    if (!v.is_active) { const e = new Error('Voucher tidak aktif.'); e.code = 'INACTIVE'; throw e; }
    if (v.expires_at && new Date(v.expires_at).getTime() < Date.now()) {
      const e = new Error('Voucher sudah kedaluwarsa.'); e.code = 'EXPIRED'; throw e;
    }
    if (Number(v.used_count) >= Number(v.max_uses)) {
      const e = new Error('Voucher sudah habis digunakan.'); e.code = 'EXHAUSTED'; throw e;
    }

    // Per-user limit.
    const ur = await client.query(
      "SELECT count(*)::int AS n FROM voucher_redemptions WHERE voucher_id = $1 AND user_id = $2",
      [v.id, userId]
    );
    if (Number(ur.rows[0].n) >= Number(v.per_user_limit)) {
      const e = new Error('Kamu sudah menggunakan voucher ini.'); e.code = 'USER_LIMIT'; throw e;
    }

    // Record redemption + bump used_count + credit wallet.
    await client.query(
      "INSERT INTO voucher_redemptions (voucher_id, user_id, amount) VALUES ($1, $2, $3)",
      [v.id, userId, v.amount]
    );
    await client.query(
      "UPDATE vouchers SET used_count = used_count + 1, updated_at = now() WHERE id = $1",
      [v.id]
    );
    const balance = await wallet.adjust(client, {
      userId, type: 'voucher', amount: Number(v.amount),
      refOrderId: null, note: `Voucher ${v.code}`,
    });
    return { ok: true, amount: Number(v.amount), balance, code: v.code };
  });
}

/* Admin: list vouchers with usage. */
async function listVouchers(limit = 100) {
  const r = await query(
    `SELECT id, code, amount, max_uses, used_count, per_user_limit, expires_at,
            is_active, note, created_at
       FROM vouchers ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return r.rows;
}

/* Admin: create a voucher. */
async function createVoucher({ code, amount, maxUses = 1, perUserLimit = 1, expiresAt = null, note = null }) {
  const norm = normalizeCode(code);
  if (!norm) throw new Error('Kode wajib diisi.');
  const amt = Math.round(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('Nominal harus angka > 0.');
  const r = await query(
    `INSERT INTO vouchers (code, amount, max_uses, per_user_limit, expires_at, note)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [norm, amt, Math.max(1, Number(maxUses) || 1), Math.max(1, Number(perUserLimit) || 1),
     expiresAt || null, note || null]
  );
  return r.rows[0];
}

/* Admin: toggle active / delete. */
async function setVoucherActive(id, active) {
  const r = await query("UPDATE vouchers SET is_active = $2, updated_at = now() WHERE id = $1 RETURNING *", [id, !!active]);
  return r.rows[0] || null;
}
async function deleteVoucher(id) {
  await query("DELETE FROM vouchers WHERE id = $1", [id]);
  return { ok: true };
}

module.exports = {
  normalizeCode, redeemVoucher, listVouchers, createVoucher, setVoucherActive, deleteVoucher,
};
