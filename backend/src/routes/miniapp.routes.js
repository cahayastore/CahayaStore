'use strict';
/* ════════════════════════════════════════════════════════════════════
   Telegram Mini App endpoints (validate initData server-side).
   - POST /api/auth/telegram/miniapp-login   → JWT session
   - POST /api/public/miniapp/customer-context → profile + balance
   A tiny in-memory rate limiter guards these (per IP).
   ════════════════════════════════════════════════════════════════════ */
const express = require('express');
const { authenticateMiniApp } = require('../telegram/miniapp-auth');
const { issueGatewaySession, issueWebSession } = require('../customer-auth');
const wallet = require('../wallet.service');
const { query } = require('../db');

const router = express.Router();

// Simple sliding-window rate limit (per IP) — 30 req / 60s.
const hits = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const now = Date.now();
  const windowStart = now - 60000;
  const arr = (hits.get(ip) || []).filter((t) => t > windowStart);
  arr.push(now);
  hits.set(ip, arr);
  if (arr.length > 30) return res.status(429).json({ success: false, message: 'Terlalu banyak permintaan.' });
  next();
}

/* POST /api/auth/telegram/miniapp-login  { initData } → { gatewaySession, webSessionToken } */
router.post('/auth/telegram/miniapp-login', rateLimit, async (req, res) => {
  const { initData } = req.body || {};
  const auth = await authenticateMiniApp(initData);
  if (!auth.ok) return res.status(401).json({ success: false, message: 'initData tidak valid.', reason: auth.reason });

  const user = auth.dbUser;
  const gatewaySession = issueGatewaySession(user);
  const webSessionToken = issueWebSession(user);
  res.json({
    success: true,
    data: {
      gatewaySession,
      webSessionToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    },
  });
});

/* POST /api/public/miniapp/customer-context  { initData } → profile + balance */
router.post('/public/miniapp/customer-context', rateLimit, async (req, res) => {
  const { initData } = req.body || {};
  const auth = await authenticateMiniApp(initData);
  if (!auth.ok) return res.status(401).json({ success: false, message: 'initData tidak valid.', reason: auth.reason });

  const user = auth.dbUser;
  const balance = await wallet.getBalance(user.id).catch(() => 0);
  const orders = await query('SELECT count(*)::int AS n FROM orders WHERE user_id = $1', [user.id]).catch(() => ({ rows: [{ n: 0 }] }));
  let referralCode = user.referral_code;
  if (!referralCode) {
    const r = await query('SELECT referral_code FROM users WHERE id = $1', [user.id]).catch(() => null);
    referralCode = r?.rows?.[0]?.referral_code || null;
  }
  res.json({
    success: true,
    data: {
      user: { id: user.id, name: user.name, email: user.email },
      balance,
      orderCount: orders.rows[0].n,
      referralCode,
    },
  });
});

module.exports = router;
