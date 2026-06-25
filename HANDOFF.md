# CahayaStore — Session Handoff / Context

> Read this first when continuing work in a new session. It captures how the
> project works, the infra, conventions, and the current state so you can pick
> up without re-discovering everything.

_Last updated: 2026-06-25_

## What this project is
Cahaya Store (`cahayastore.me`) — a small single-store digital marketplace
(premium accounts, digital files, vouchers) with QRIS payment, a Telegram
commerce bot, an admin panel, and a storefront. It's a smaller sibling of the
Marketku/Rayfaz_Store project (which is REFERENCE ONLY — never edit/deploy
Marketku for CahayaStore work; replicate its ideas into CahayaStore instead).

## Hard rules / conventions
- Modular, structured files. Max ~300–500 lines per file. No monoliths — split
  per route/page/service/module.
- Admin panel style: Marketku design system (`--mkd-*`, `--ds-color-*`), light
  blue `#2563EB`, sidebar+topbar like dashboard.marketku.id.
- Storefront style: blue Cahaya Design System (CDS), `--cds-*` tokens, primary
  `#307fe2`, accent `#f46200`, with a built-in light + dark theme (toggled via
  `data-theme="dark"`, set early by `cds-theme.js`). NOTE: the earlier
  "dark purple neon" idea was DROPPED in favour of this committed blue CDS —
  do not resurrect it without explicit direction.
- Never print secrets. Never commit `.env`.

## Infra
- VPS: `root@143.198.93.85` (Ubuntu 24.04, Node 20.x). SSH from laptop with
  `ssh -i "$HOME\.ssh\id_ed25519_vps" root@143.198.93.85`.
- PM2 services:
  - `cahayastore-api` — port 3100, bound 127.0.0.1 (the Express backend).
  - `cahayastore-deploy-hook` — port 9000 (process online; no nginx site
    enabled for it yet — see pending #4).
- Nginx serves: `cahayastore.me`, `www`, `api`, `admin`, `pay` subdomains.
  Cloudflare proxied + HTTPS.
- Postgres: local on the VPS (not Supabase). Daily backup cron 02:30 →
  `/root/backups` (30-day retention), script `/root/scripts/daily-backup.sh`.
- Uploads: stored at `/var/www/cahayastore/uploads`, served at
  `https://api.cahayastore.me/uploads/<file>` (sharp → webp).
- Backend `.env`: `/root/cahayastore/backend/.env` (has SETTINGS_ENCRYPTION_KEY
  — do NOT rotate unless re-encrypting the settings table).
- PM2 logs: `/root/.pm2/logs/cahayastore-api-out-0.log` and
  `…-error-0.log` (NOT the unsuffixed name).

## Repo & deploy
- GitHub: `git@github.com:cahayastore/CahayaStore.git`, branch `main`.
- Server repo: `/root/cahayastore` (this is the SOURCE OF TRUTH).
- IMPORTANT: the laptop usually CAN'T push directly (default SSH key points at
  the Marketku repo) and often has NO local clone at all. The working flow:
  - Edit locally in a scratch dir (e.g. `~/cahayastore-work/…`), `node -c` to
    syntax-check.
  - `scp` the file(s) to the matching server path.
  - `ssh … "cd /root/cahayastore/backend && node -c <file> && pm2 restart
    cahayastore-api --update-env"` to verify online.
  - `cd /root/cahayastore && git add … && git commit` ON THE SERVER, then
    `git push origin main` FROM THE SERVER.
- PowerShell quoting gotcha: running remote commands through
  `ssh … "<cmd>"` strips inner quotes and chokes on `(` `)` `|` in grep
  patterns. Prefer single, simple patterns; or scp the file down and read it
  with editor tools. Sync-mode terminal output can also drop — async mode with
  a trailing `echo MARKER_END` is reliable.
- `deploy.sh` at repo root: npm ci backend, npm run migrate, npm ci deploy-hook,
  pm2 startOrReload ecosystem.config.js, copy storefront/pay index.html to
  /var/www/cahayastore/.

## Backend layout (`/root/cahayastore/backend`)
- `server.js` (~150 lines) — Express entry. Mounts, in order:
  - `/api/webhooks` (raw body) → `webhook.routes.js`
  - `/webhooks/telegram` (inline, JSON) → bot-loader handleUpdate
  - then JSON/urlencoded parsers + rate limiters
  - `/api/auth` → auth.routes; `/api` → public, checkout, web-checkout,
    miniapp; `/api/admin` → admin/.
  - static `/uploads`, `/admin` SPA. Background sweeper expires stale orders.
    Startup (re)registers the Telegram webhook and resumes broadcasts.
- `src/db.js`, `src/crypto.js` (encryptString/decryptString + safeEqual),
  `src/auth.middleware.js` (requireAuth), `src/customer-auth.js`
  (issueGatewaySession/issueWebSession/resolveCustomer),
  `src/settings.service.js` (KEYS + getSetting/setSetting; settings are the
  config store — MyQRIS + Telegram creds live here, NOT in .env),
  `src/wallet.service.js` (creditTopup, payReferralBonus),
  `src/voucher.service.js`, `src/broadcast.service.js`, `src/rate-limit.js`,
  `src/redis.js`, `src/qris-card.service.js` (branded QRIS PNG card),
  `src/barcode.service.js` (renderBarcodePng via bwip-js).
- `src/routes/`: auth, public, checkout (legacy), web-checkout (main),
  miniapp, webhook, `admin/` (dashboard, products, categories, orders,
  settings, stocks, uploads).
- `src/payment/myqris.service.js` — REAL dynamic-QRIS builder (static→dynamic,
  EMV TLV tag rewrite, CRC16-CCITT, sanitized merchant name/city) + PayHook
  shared-token verify. Flow is PayHook-app based (no third-party API): buyer
  pays an exact unique rupiah amount, the PayHook Android app forwards the
  bank/e-wallet notification to our webhook, we match by amount and deliver.
- `src/telegram/`: `bot-loader.js` (grammy Bot; exports sendMessage, sendPhoto,
  notifyBuyer, notifyOrderPaid, escapeHtml, handleUpdate, registerWebhook,
  verifyWebhookSecret, …), `handlers/` (start, buy, v3-menu, topup, _rich,
  _reply, _shared, …), `miniapp-auth.js` (validateInitData).
- `migrations/NNN_*.sql` — forward-only runner (`scripts/migrate.js`), tracked
  in `schema_migrations`. CHECK-constraint changes: DROP + re-ADD (see 007/009).

## Payment / webhook flow (IMPORTANT — verified live)
- Production PayHook posts to `POST /api/payment-gateways/webhook/payhook`
  (handler in `web-checkout.routes.js`, also aliased at
  `/api/payment-gateways/webhook/myqris/payhook`). This is the CANONICAL path:
  marks paid → `deliverOrder` (assigns stock) → audit log, then post-commit
  (non-blocking): wallet topup/referral, `notifyOrderPaid` (admin),
  `deliverCredentialsToTelegram` (buyer gets creds + barcode images).
- There is ALSO a legacy `POST /api/webhooks/myqris` handler in
  `webhook.routes.js`. As of 2026-06-25 it was hardened to run the SAME
  post-commit side effects (was previously delivering stock only), so behaviour
  is identical regardless of which URL PayHook targets. Production currently
  uses the `/api/payment-gateways/webhook/payhook` path.
- Order expiry: `web-checkout.routes.js` `expireStaleOrders()` runs on a 60s
  sweeper + opportunistically on status polls; releases reserved stock.

## Admin panel (`backend/admin-panel`)
- Vanilla JS module SPA (not React). `index.html`, `tokens.css`, `styles.css`,
  `app.js`, `api.js`, `dom.js`, `shell.js`, `theme.js`, `upload-widget.js`,
  `pages/*`.
- Product wizard: `pages/products/` (constants.js, step-type/info/pricing/
  stock/review.js, wizard.js, stock-manager.js).
- Settings page (`pages/settings.js`) cards: **Ubah Password** (security, uses
  `pages/settings/change-password.js` with strength meter + force re-login),
  Telegram Bot (token/secret/admin_chat_id + webhook register/status/test
  buttons), Profil Toko, Kebijakan Order (payment expiry minutes), Banner Bot.
  Other pages: dashboard, products, categories, orders, payment, vouchers,
  users, broadcast, banners, analytics, topup-bonus, stock-alert.
- URL: https://admin.cahayastore.me/admin/  — owner: owner@cahayastore.me.

## Telegram bot
- Token + config in settings key `telegram.bot` (admin-managed). Bot username
  `@CahayaStoreOfficial_bot`. Owner chat id used for tests: 6664945344.
- Webhook is registered to `https://api.cahayastore.me/webhooks/telegram`
  (verified). Re-registered automatically on API startup.
- Product list (`/start`, v3-menu.js) renders a REAL bordered table via Rich
  Messages (`sendRichMessage`, Bot API 10.1+) through helper `handlers/_rich.js`
  (`sendRichTable`/`buildTableHtml`); falls back to a monospace <pre> table.
  Pass grammy Keyboard objects AS-IS to sendRichMessage (never `.build()`).

## Stock model & the barcode feature
- `product_stocks`: content_type IN (file, credential, code, note, barcode);
  status available/reserved/sold/disabled; encrypted_content holds the value;
  `sold_order_id` links sold units to an order; `reserved_order_id`/
  `reserved_until` hold reservations; `barcode_symbology` column.
- Barcode stock type (migration 009): two modes —
  1. RENDER mode: admin types a value; bot renders PNG via bwip-js. Symbology
     code128 | ean13 | qrcode | auto (auto→ean13 for 13/12-digit numerics else
     code128; invalid ean13 falls back to code128).
  2. IMAGE mode (symbology = 'image'): admin UPLOADS a ready-made barcode/
     voucher image; encrypted_content stores the uploaded image URL; bot
     delivers it as-is (no render, no raw URL leaked into text).
- Delivery: `web-checkout.routes.js` → `deliverCredentialsToTelegram()` sends a
  text summary + each barcode as a photo. Web: GET
  `/api/public/web-checkout/barcode/:orderNo.png?token=` renders server-side
  (re-verifies owner/token; value never from URL); credentials endpoint returns
  cred.type='barcode' with imageUrl.

## Verify commands (quick)
- API health: `curl https://api.cahayastore.me/health`
- Products: `curl https://api.cahayastore.me/api/products`
- Service: `ssh … "pm2 info cahayastore-api | grep status"`

## Current state (2026-06-25) — most HANDOFF "pending" items were ALREADY DONE
Verified this session; the previous pending list was stale. Status:
1. ✅ Change-password admin UI — DONE (settings card + endpoint with bcrypt,
   rate-limit, audit log, force re-login).
2. ✅ Storefront design — DONE; committed blue CDS with light+dark theme. The
   "dark purple neon" target was abandoned; no in-flight conflict remains.
3. ✅ Order flow detail→checkout→pay — DONE (web-checkout: create order +
   unique-amount QRIS invoice, branded QR PNG, status poll, credentials/barcode
   delivery, order history; pay.cahayastore.me front-end present).
4. ✅ MyQRIS integration — DONE (real dynamic-QRIS builder + PayHook webhook,
   live traffic confirmed). It's PayHook-app based, not a 3rd-party REST API.
5. ✅ Telegram setWebhook helper — DONE (admin Settings → register/status/test
   buttons; also auto-registers on startup).

### Work done THIS session
- Hardened legacy `/api/webhooks/myqris` handler to run the full post-commit
  side effects (buyer Telegram delivery, admin notify, wallet topup/referral),
  matching the canonical PayHook handler — so it can't silently under-deliver
  if PayHook is ever repointed there.
- Fixed a latent 500 in legacy `POST /api/checkout`: a missing `product_id`
  became the string `"undefined"` and threw `invalid input syntax for type
  uuid`. Added a UUID-shape guard that returns a clean 400.

## Pending / recommended next work
1. Register a GitHub deploy webhook for `cahayastore-deploy-hook` (process is
   online on :9000 but no nginx `deploy.` site is enabled; decide whether to
   expose it or trigger deploys another way).
2. Consider RETIRING the legacy `/api/webhooks/myqris` and `/api/checkout`
   endpoints once confirmed unused, to remove duplicate payment logic (now
   behaviour-equivalent but still two code paths to maintain).
3. Root `index.html` and `deploy-hook/package-lock.json` show as untracked on
   the server — decide whether to gitignore (root index.html is a deploy
   artifact copy of storefront/index.html) or track them.
4. Keep syncing server→laptop. Laptop typically has no clone; use the
   scp-to-server + commit-on-server flow above.

## How to resume in a new session (do this)
1. SSH in and read this file:
   `ssh -i "$HOME\.ssh\id_ed25519_vps" root@143.198.93.85 "cat /root/cahayastore/HANDOFF.md"`.
2. Run the quick verify commands above (health, products, pm2 status).
3. Remember: server `/root/cahayastore` is the source of truth; edit locally →
   `node -c` → scp → verify → commit & push ON THE SERVER.
