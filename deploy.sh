#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "[deploy] $(date -Is) start"
echo "[deploy] commit: $(git rev-parse --short HEAD) ($(git log -1 --pretty=%s))"

cd backend
npm ci --omit=dev --no-audit --no-fund
npm run migrate || { echo "[deploy] migrate failed"; exit 1; }
cd ..

cd deploy-hook
npm ci --omit=dev --no-audit --no-fund || true
cd ..

pm2 startOrReload ecosystem.config.js --env production
pm2 save

# Refresh static storefront / pay landing files
mkdir -p /var/www/cahayastore/store /var/www/cahayastore/pay
cp -f storefront/index.html /var/www/cahayastore/store/index.html
cp -f pay/index.html /var/www/cahayastore/pay/index.html

echo "[deploy] $(date -Is) done"
