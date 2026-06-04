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

module.exports = router;
