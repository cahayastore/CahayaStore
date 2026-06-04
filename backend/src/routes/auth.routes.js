'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { signToken, requireAuth } = require('../auth.middleware');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'email and password required' });
  }
  const r = await query(
    "SELECT id, role, name, email, password_hash, is_active FROM users WHERE email = $1",
    [String(email).toLowerCase().trim()]
  );
  const user = r.rows[0];
  if (!user || !user.is_active || !user.password_hash) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ success: false, message: 'Invalid credentials' });
  const token = signToken(user);
  return res.json({
    success: true,
    token,
    user: { id: user.id, role: user.role, name: user.name, email: user.email }
  });
});

router.get('/me', requireAuth(), (req, res) => {
  res.json({ success: true, user: req.user });
});

/**
 * POST /api/auth/change-password
 * Body: { current_password, new_password }
 * Requires Bearer token. Verifies current password lalu update bcrypt hash.
 * Rules:
 *   - new_password min 10 char
 *   - new_password != current_password
 *   - rate-limit ringan: max 5 attempt / 10 menit per user (in-memory)
 */
const _changePwAttempts = new Map(); // userId -> { count, resetAt }
function _rateLimit(userId) {
  const now = Date.now();
  const slot = _changePwAttempts.get(userId);
  if (!slot || slot.resetAt < now) {
    _changePwAttempts.set(userId, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return true;
  }
  if (slot.count >= 5) return false;
  slot.count += 1;
  return true;
}

router.post('/change-password', requireAuth(), async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ success: false, message: 'current_password and new_password required' });
  }
  if (typeof new_password !== 'string' || new_password.length < 10) {
    return res.status(400).json({ success: false, message: 'New password minimal 10 karakter' });
  }
  if (new_password === current_password) {
    return res.status(400).json({ success: false, message: 'Password baru harus berbeda dari password saat ini' });
  }
  const userId = req.user.sub;
  if (!_rateLimit(userId)) {
    return res.status(429).json({ success: false, message: 'Terlalu banyak percobaan. Coba lagi nanti.' });
  }

  const r = await query(
    'SELECT id, password_hash, is_active FROM users WHERE id = $1',
    [userId]
  );
  const user = r.rows[0];
  if (!user || !user.is_active || !user.password_hash) {
    return res.status(401).json({ success: false, message: 'Akun tidak aktif' });
  }
  const ok = await bcrypt.compare(current_password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ success: false, message: 'Password saat ini salah' });
  }

  const newHash = await bcrypt.hash(new_password, 12);
  await query(
    'UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2',
    [newHash, userId]
  );

  // Audit log (best-effort)
  try {
    const meta = JSON.stringify({
      ip: req.ip || null,
      user_agent: req.headers['user-agent'] || null,
    });
    await query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'password.change', 'user', $1, $2::jsonb)`,
      [userId, meta]
    );
  } catch (_) { /* non-fatal */ }

  res.json({ success: true, message: 'Password berhasil diubah' });
});

module.exports = router;
