'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3100);
const startedAt = new Date();

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: false }));
app.use(cors({
  origin: [
    'https://cahayastore.me',
    'https://www.cahayastore.me',
    'https://admin.cahayastore.me',
    'https://pay.cahayastore.me'
  ],
  credentials: true
}));

// Webhook routes MUST mount before json parser (need raw body for HMAC)
app.use('/api/webhooks',
  express.raw({ type: '*/*', limit: '1mb' }),
  require('./src/routes/webhook.routes'));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(compression({ level: 3, threshold: 1024 }));
app.use(morgan('combined'));

app.get('/', (_req, res) => res.json({ service: 'cahayastore-api', status: 'ok' }));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'cahayastore-api',
    uptime: process.uptime(),
    startedAt,
    timestamp: new Date().toISOString()
  });
});

// Mount routes
app.use('/api/auth', require('./src/routes/auth.routes'));
app.use('/api', require('./src/routes/public.routes'));
app.use('/api', require('./src/routes/checkout.routes'));
const webCheckout = require('./src/routes/web-checkout.routes');
app.use('/api', webCheckout);
app.use('/api/admin', require('./src/routes/admin'));

// Serve uploaded media from a persistent dir (survives deploys).
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/var/www/cahayastore/uploads';
app.use('/uploads', (req, res, next) => {
  // Allow these images to be embedded cross-origin (storefront + admin hosts).
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
}, express.static(UPLOADS_DIR, {
  maxAge: '7d',
  immutable: true,
  fallthrough: true,
}));

// Serve mini admin SPA
const ADMIN_DIR = path.resolve(__dirname, 'admin-panel');
app.use('/admin', express.static(ADMIN_DIR, {
  extensions: ['html'],
  setHeaders: (res) => {
    // Admin JS/CSS are unversioned ES modules — never cache so updates load fresh.
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  },
}));
app.get('/admin/*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(ADMIN_DIR, 'index.html'));
});

app.use((_req, res) => res.status(404).json({ success: false, message: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`Cahaya Store API listening on 127.0.0.1:${PORT}`);
});
server.requestTimeout = 30000;
server.headersTimeout = 35000;
server.keepAliveTimeout = 5000;

// Background sweeper: expire stale pending orders + release reserved stock.
if (typeof webCheckout.expireStaleOrders === 'function') {
  const SWEEP_MS = Number(process.env.ORDER_SWEEP_MS) || 60000;
  const sweep = () => webCheckout.expireStaleOrders()
    .then((n) => { if (n) console.log(`[sweeper] expired ${n} stale order(s)`); })
    .catch((e) => console.error('[sweeper]', e.message));
  const timer = setInterval(sweep, SWEEP_MS);
  timer.unref();
  setTimeout(sweep, 5000).unref();
}
