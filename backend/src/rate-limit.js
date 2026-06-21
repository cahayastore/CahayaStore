'use strict';
/* Centralized rate limiters for abuse-prone endpoints.
   Uses express-rate-limit (in-memory store; fine for a single PM2 instance).
   Behind Cloudflare + nginx, the real client IP is in CF-Connecting-IP /
   X-Real-IP, so we key on that (falling back to X-Forwarded-For / req.ip). */
const rateLimit = require('express-rate-limit');

function clientKey(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(cf);
  const xr = req.headers['x-real-ip'];
  if (xr) return String(xr);
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function make({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: clientKey,
    handler: (_req, res) => res.status(429).json({
      success: false,
      message: message || 'Terlalu banyak permintaan. Coba lagi sebentar.',
    }),
  });
}

// Auth (login/register/refresh) — brute-force sensitive. Tight.
const authLimiter = make({ windowMs: 15 * 60 * 1000, max: 30, message: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' });

// Checkout / order creation — prevents order/stock-reservation spam.
const checkoutLimiter = make({ windowMs: 60 * 1000, max: 15, message: 'Terlalu banyak pesanan dalam waktu singkat. Tunggu sebentar.' });

// Payment status polling + credential fetch — frequent but capped.
const pollLimiter = make({ windowMs: 60 * 1000, max: 120 });

// File uploads — heavier; keep modest.
const uploadLimiter = make({ windowMs: 60 * 1000, max: 30, message: 'Terlalu banyak unggahan. Tunggu sebentar.' });

// Generic public API read fallback (broad safety net).
const publicLimiter = make({ windowMs: 60 * 1000, max: 200 });

module.exports = { authLimiter, checkoutLimiter, pollLimiter, uploadLimiter, publicLimiter };
