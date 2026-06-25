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
- Storefront style target: dark purple neon (per user screenshots).
- Never print secrets. Never commit `.env`.

## Infra
- VPS: `root@143.198.93.85` (Ubuntu 24.04, Node 20.x).
- PM2 services:
  - `cahayastore-api` — port 3100, bound 127.0.0.1 (the Express backend).
  - `cahayastore-deploy-hook` — port 9000.
- Nginx serves: `cahayastore.me`, `www`, `api`, `admin`, `pay`, `deploy`
  subdomains. Cloudflare proxied + HTTPS.
- Postgres: local on the VPS (not Supabase). Daily backup cron 02:30 →
  `/root/backups` (30-day retention), script `/root/scripts/daily-backup.sh`.
- Uploads: stored at `/var/www/cahayastore/uploads`, served at
  `https://api.cahayastore.me/uploads/<file>` (sharp → webp).
- Backend `.env`: `/root/cahayastore/backend/.env` (has SETTINGS_ENCRYPTION_KEY
  — do NOT rotate unless re-encrypting the settings table).

## Repo & deploy
- GitHub: `git@github.com:cahayastore/CahayaStore.git`, branch `main`.
- Server repo: `/root/cahayastore` (this is the SOURCE OF TRUTH).
- IMPORTANT: the laptop usually CAN'T push directly (default SSH key points at
  the Marketku repo). The working flow this session has used:
  - Edit locally (staging copies), `node -c` to syntax-check.
  - `scp` the file(s) to the server path.
  - `ssh ... node -c <file> && pm2 restart cahayastore-api` to verify online.
  - `cd /root/cahayastore && git add ... && git commit` ON THE SERVER.
  - To pull server commits to laptop: `git fetch` from the server or use the
    bundle flow (git bundle → scp → fetch/merge on VPS → push origin).
- `deploy.sh` at repo root: npm ci backend, npm run migrate, npm ci deploy-hook,
  pm2 startOrReload ecosystem.config.js, copy storefront/pay index.html to
  /var/www/cahayastore/.

## Backend layout (`/root/cahayastore/backend`)
- `server.js` — Express entry (static serves /uploads and /admin).
- `src/db.js`, `src/crypto.js` (encryptString/decryptString),
  `src/auth.middleware.js` (requireAuth), `src/customer-auth.js`,
  `src/settings.service.js` (KEYS + getSetting/setSetting; settings are the
  config store — MyQRIS + Telegram creds live here, NOT in .env).
- `src/routes/`: auth, public, checkout, web-checkout, miniapp, webhook,
  `admin/` (dashboard, products, categories, orders, settings, stocks, uploads).
- `src/telegram/`: `bot-loader.js` (grammy Bot; exports sendMessage, sendPhoto,
  notifyBuyer, escapeHtml, etc.), `handlers/` (start, buy, v3-menu, _rich,
  _reply, _shared, ...).
- `src/barcode.service.js` — renders barcode values to PNG (bwip-js).
- `migrations/NNN_*.sql` — forward-only runner (`scripts/migrate.js`), tracked in
  `schema_migrations`. CHECK-constraint changes: DROP + re-ADD (see 007, 009).

## Admin panel (`backend/admin-panel`)
- Vanilla JS module SPA (not React). `index.html`, `tokens.css`, `styles.css`,
  `app.js`, `api.js`, `dom.js`, `shell.js`, `pages/*`.
- Product wizard: `pages/products/` (constants.js, step-type/info/pricing/
  stock/review.js, wizard.js, stock-manager.js).
- URL: https://admin.cahayastore.me/admin/  — owner: owner@cahayastore.me
  (password was temporary; change-password endpoint exists at
  POST /api/auth/change-password).

## Telegram bot
- Token + config in settings key `telegram.bot` (admin-managed). Bot username
  `@CahayaStoreOfficial_bot`. Owner chat id used for tests: 6664945344.
- Product list (`/start`, v3-menu.js) renders a REAL bordered table via Rich
  Messages (`sendRichMessage`, Bot API 10.1+) through helper `handlers/_rich.js`
  (`sendRichTable`/`buildTableHtml`); falls back to a monospace <pre> table.
  Pass grammy Keyboard objects AS-IS to sendRichMessage (never `.build()`).

## Stock model & the barcode feature (most recent work)
- `product_stocks`: content_type IN (file, credential, code, note, barcode);
  status available/reserved/sold/disabled; encrypted_content holds the value;
  sold_order_id links sold units to an order; `barcode_symbology` column.
- Barcode stock type (migration 009): two modes —
  1. RENDER mode: admin types a value; bot renders PNG via bwip-js. Symbology
     code128 | ean13 | qrcode | auto (auto→ean13 for 13/12-digit numerics else
     code128; invalid ean13 falls back to code128).
  2. IMAGE mode (symbology = 'image'): admin UPLOADS a ready-made barcode/voucher
     image; encrypted_content stores the uploaded image URL; bot delivers it
     as-is (no render, no raw URL leaked into text).
- Delivery: `web-checkout.routes.js` → `deliverCredentialsToTelegram()` sends a
  text summary + each barcode as a photo. Web: GET
  `/api/public/web-checkout/barcode/:orderNo.png?token=` renders server-side
  (re-verifies owner/token; value never from URL); credentials endpoint returns
  cred.type='barcode' with imageUrl.
- Admin UI: `stock-manager.js` barcode option + symbology selector + "Upload
  Gambar" multi-file uploader.

## Verify commands (quick)
- API health: `curl https://api.cahayastore.me/health`
- Products: `curl https://api.cahayastore.me/api/products`
- Service: `ssh root@143.198.93.85 "pm2 info cahayastore-api | grep status"`

## Pending / recommended next work
1. Change-password admin UI form (endpoint exists).
2. Dark purple neon storefront redesign — NOTE: there were in-flight uncommitted
   light-blue `storefront/` changes that CONFLICT with the dark-neon target;
   resolve direction before continuing.
3. Order flow: product detail → checkout → pay page (pay.cahayastore.me).
4. MyQRIS real API integration (needs credentials/docs; config in settings
   `payment.myqris`).
5. Telegram setWebhook helper button in admin.
6. Register GitHub deploy webhook (deploy.cahayastore.me/webhook) if not done.
7. The laptop repo had drifted behind the server — keep syncing server→laptop.

## How to resume in a new session (do this)
1. On the new PC, clone/pull the repo so this file is present:
   `git clone git@github.com:cahayastore/CahayaStore.git` (or pull main).
2. Tell the new session: "Read HANDOFF.md in the repo root and continue the
   CahayaStore work." It will then have all the context above.
3. Confirm SSH access to `root@143.198.93.85` works (the workflow relies on
   scp/ssh to the VPS). If the laptop can't push to GitHub, use the
   scp-to-server + commit-on-server flow described under "Repo & deploy".
