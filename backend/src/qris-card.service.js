'use strict';
/* Branded QRIS card generator (compact).
   Renders a clean card: Cahaya Store logo, order number, a BLUE QR code,
   total amount, and an optional subtitle (product / "Top Up Saldo").
   Returns a PNG Buffer suitable for ctx.replyWithPhoto(new InputFile(buf)). */
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const sharp = require('sharp');

// Candidate logo locations (storefront first, then admin panel fallback).
const LOGO_CANDIDATES = [
  '/var/www/cahayastore/store/assets/logo.png',
  path.join(__dirname, '..', 'admin-panel', 'assets', 'logo.png'),
];

let _logoCache; // resolved once: { buf, width, height } | null

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function rupiah(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
}

/* Load + resize the logo to a target width once, cached. Returns null on failure. */
async function getLogo(targetW) {
  if (_logoCache !== undefined) return _logoCache;
  for (const p of LOGO_CANDIDATES) {
    try {
      if (!fs.existsSync(p)) continue;
      const resized = await sharp(p)
        .resize({ width: targetW, withoutEnlargement: false })
        .png()
        .toBuffer();
      const meta = await sharp(resized).metadata();
      _logoCache = { buf: resized, width: meta.width, height: meta.height };
      return _logoCache;
    } catch (e) { /* try next */ }
  }
  _logoCache = null;
  return null;
}

/* Generate the QR as blue modules on white, returned as PNG buffer. */
async function makeBlueQr(data, size) {
  return QRCode.toBuffer(String(data), {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: size,
    color: { dark: '#1d4ed8ff', light: '#ffffffff' },
  });
}

/* Build the compact branded card PNG.
   opts: { qrisData, orderNo, amount, subtitle } */
async function buildQrisCard({ qrisData, orderNo = '', amount = 0, subtitle = '' }) {
  // Compact canvas.
  const W = 560;
  const qrSize = 360;
  const logoW = 280;

  const qrBuf = await makeBlueQr(qrisData, qrSize);
  const logo = await getLogo(logoW);

  // Vertical layout cursor.
  const padX = 28;
  const logoTop = 34;
  const logoH = logo ? logo.height : 0;
  const orderLabelY = logoTop + logoH + (logo ? 44 : 60);
  const orderNoY = orderLabelY + 32;
  const qrFrameY = orderNoY + 26;
  const qrY = qrFrameY + 16;
  const qrX = Math.round((W - qrSize) / 2);
  const amountLabelY = qrY + qrSize + 48;
  const amountY = amountLabelY + 44;
  const subtitleY = subtitle ? amountY + 36 : amountY;
  const footerY = subtitleY + (subtitle ? 44 : 40);
  const H = footerY + 30;

  const svg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="12" flood-color="#1d4ed8" flood-opacity="0.14"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="#eef3ff"/>
  <rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="22" fill="#ffffff" filter="url(#shadow)"/>

  ${orderNo ? `<text x="${W / 2}" y="${orderLabelY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="#94a3b8">No. Pesanan</text>` : ''}
  ${orderNo ? `<text x="${W / 2}" y="${orderNoY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="bold" fill="#1d4ed8">#${esc(orderNo)}</text>` : ''}

  <rect x="${qrX - 14}" y="${qrY - 14}" width="${qrSize + 28}" height="${qrSize + 28}" rx="16" fill="#ffffff" stroke="#dbeafe" stroke-width="2"/>

  <text x="${W / 2}" y="${amountLabelY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="#94a3b8">Total Pembayaran</text>
  <text x="${W / 2}" y="${amountY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="bold" fill="#1d4ed8">${esc(rupiah(amount))}</text>
  ${subtitle ? `<text x="${W / 2}" y="${subtitleY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="bold" fill="#334155">${esc(subtitle)}</text>` : ''}

  <text x="${W / 2}" y="${footerY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#b4bccc">Cahaya Store · Scan untuk membayar</text>
</svg>`;

  const composites = [{ input: qrBuf, top: qrY, left: qrX }];
  if (logo) {
    composites.unshift({ input: logo.buf, top: logoTop, left: Math.round((W - logo.width) / 2) });
  }

  return sharp(Buffer.from(svg)).composite(composites).png().toBuffer();
}

module.exports = { buildQrisCard };
