'use strict';
/* Branded QRIS card generator (compact, modern dotted QR).
   Renders a clean card: Cahaya Store logo, a BLUE rounded/dotted QR code with a
   center logo, total amount, an optional subtitle, and the ORDER NUMBER label
   under the QR (where a "scan me" label would normally sit).
   Returns a PNG Buffer suitable for ctx.replyWithPhoto(new InputFile(buf)). */
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const sharp = require('sharp');

// Candidate logo locations (storefront first, then admin panel fallback).
const LOGO_CANDIDATES = [
  '/var/www/cahayastore/store/assets/logo-light.png',
  '/var/www/cahayastore/store/assets/logo.png',
  path.join(__dirname, '..', 'admin-panel', 'assets', 'logo.png'),
];
// Square mark for the QR center (falls back to the full logo).
const MARK_CANDIDATES = [
  '/var/www/cahayastore/store/assets/logo-mark.png',
  '/var/www/cahayastore/store/assets/favicon.png',
  '/var/www/cahayastore/store/assets/logo.png',
  path.join(__dirname, '..', 'admin-panel', 'assets', 'logo.png'),
];

const QR_COLOR = '#1d4ed8';
let _logoCache;
let _markCache;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function rupiah(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

async function loadResized(candidates, targetW) {
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const buf = await sharp(p).resize({ width: targetW, withoutEnlargement: false }).png().toBuffer();
      const meta = await sharp(buf).metadata();
      return { buf, width: meta.width, height: meta.height };
    } catch (e) { /* next */ }
  }
  return null;
}
async function getLogo(targetW) {
  if (_logoCache === undefined) _logoCache = await loadResized(LOGO_CANDIDATES, targetW);
  return _logoCache;
}
async function getMark(targetW) {
  if (_markCache === undefined) _markCache = await loadResized(MARK_CANDIDATES, targetW);
  return _markCache;
}

/* Render the QR module matrix as an SVG fragment. Every dark module is drawn as
   a slightly-rounded square that fills its cell (no gaps) so the symbol stays
   reliably scannable while looking softer/modern. The 3 finder eyes get a bit
   more rounding on their outer corners. A small center region is left blank for
   the logo (safe with errorCorrectionLevel 'H'). Includes a quiet zone. */
function renderQrSvg(text, px, x0, y0) {
  const qr = QRCode.create(String(text), { errorCorrectionLevel: 'H' });
  const n = qr.modules.size;
  const data = qr.modules.data;
  const QUIET = 4; // modules of quiet zone around the symbol
  const cell = px / (n + QUIET * 2);
  const ox0 = x0 + QUIET * cell;
  const oy0 = y0 + QUIET * cell;
  const rad = cell * 0.30; // module corner radius (subtle)

  // Clear a small center hole (~14% of size) for the logo.
  const holeR = Math.ceil(n * 0.14 / 2);
  const c0 = Math.floor(n / 2) - holeR;
  const c1 = Math.floor(n / 2) + holeR;
  const inHole = (row, col) => (row >= c0 && row <= c1 && col >= c0 && col <= c1);

  let mods = '';
  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col < n; col += 1) {
      if (!data[row * n + col]) continue;
      if (inHole(row, col)) continue;
      const x = ox0 + col * cell;
      const y = oy0 + row * cell;
      // Use full-cell rounded squares (no inset) for robust scanning.
      mods += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" rx="${rad.toFixed(2)}"/>`;
    }
  }

  // Soften the 3 finder-pattern outer corners with rounded plates underneath.
  const eyePlate = (gridR, gridC) => {
    const ex = ox0 + gridC * cell;
    const ey = oy0 + gridR * cell;
    const s = 7 * cell;
    return `<rect x="${ex.toFixed(2)}" y="${ey.toFixed(2)}" width="${s.toFixed(2)}" height="${s.toFixed(2)}" rx="${(cell * 1.6).toFixed(2)}" fill="${QR_COLOR}"/>` +
      `<rect x="${(ex + cell).toFixed(2)}" y="${(ey + cell).toFixed(2)}" width="${(5 * cell).toFixed(2)}" height="${(5 * cell).toFixed(2)}" rx="${(cell * 1.2).toFixed(2)}" fill="#ffffff"/>` +
      `<rect x="${(ex + 2 * cell).toFixed(2)}" y="${(ey + 2 * cell).toFixed(2)}" width="${(3 * cell).toFixed(2)}" height="${(3 * cell).toFixed(2)}" rx="${(cell * 0.9).toFixed(2)}" fill="${QR_COLOR}"/>`;
  };
  const eyes = eyePlate(0, 0) + eyePlate(0, n - 7) + eyePlate(n - 7, 0);

  // Eyes are drawn on top so their clean rounded shape replaces the blocky modules.
  return `<g fill="${QR_COLOR}">${mods}</g>${eyes}`;
}

/* Build the compact branded card PNG.
   opts: { qrisData, orderNo, amount, subtitle } */
async function buildQrisCard({ qrisData, orderNo = '', amount = 0, subtitle = '' }) {
  const W = 560;
  const qrPx = 360;
  const logoW = 280;
  const markW = 84;

  const logo = await getLogo(logoW);
  const mark = await getMark(markW);

  const logoTop = 34;
  const logoH = logo ? logo.height : 0;

  const qrFrameY = logoTop + logoH + 28;
  const qrFramePad = 22;
  const qrX = Math.round((W - qrPx) / 2);
  const qrY = qrFrameY + qrFramePad;
  const orderLabelY = qrY + qrPx + qrFramePad + 38; // label below QR (was "scan me")
  const amountLabelY = orderLabelY + 40;
  const amountY = amountLabelY + 44;
  const subtitleY = subtitle ? amountY + 36 : amountY;
  const footerY = subtitleY + (subtitle ? 42 : 38);
  const H = footerY + 28;

  const qrSvg = renderQrSvg(qrisData, qrPx, qrX, qrY);
  const frameX = qrX - qrFramePad;
  const frameSize = qrPx + qrFramePad * 2;

  const svg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="12" flood-color="#1d4ed8" flood-opacity="0.14"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="#eef3ff"/>
  <rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="22" fill="#ffffff" filter="url(#shadow)"/>

  <!-- QR frame -->
  <rect x="${frameX}" y="${qrFrameY}" width="${frameSize}" height="${frameSize}" rx="26" fill="#ffffff" stroke="#dbeafe" stroke-width="2"/>
  ${qrSvg}

  <!-- Order number (replaces the "scan me" label) -->
  ${orderNo ? `<text x="${W / 2}" y="${orderLabelY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="bold" letter-spacing="1" fill="#1d4ed8">#${esc(orderNo)}</text>` : ''}

  <!-- Amount -->
  <text x="${W / 2}" y="${amountLabelY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="#94a3b8">Total Pembayaran</text>
  <text x="${W / 2}" y="${amountY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="bold" fill="#1d4ed8">${esc(rupiah(amount))}</text>
  ${subtitle ? `<text x="${W / 2}" y="${subtitleY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="bold" fill="#334155">${esc(subtitle)}</text>` : ''}

  <text x="${W / 2}" y="${footerY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#b4bccc">Cahaya Store · Scan untuk membayar</text>
</svg>`;

  const composites = [];
  if (logo) composites.push({ input: logo.buf, top: logoTop, left: Math.round((W - logo.width) / 2) });

  // White rounded plate + logo mark at QR center.
  const cx = qrX + qrPx / 2;
  const cy = qrY + qrPx / 2;
  const plateSize = 104;
  const plate = await sharp(Buffer.from(
    `<svg width="${plateSize}" height="${plateSize}"><rect width="${plateSize}" height="${plateSize}" rx="26" fill="#ffffff"/></svg>`
  )).png().toBuffer();
  composites.push({ input: plate, top: Math.round(cy - plateSize / 2), left: Math.round(cx - plateSize / 2) });
  if (mark) {
    composites.push({ input: mark.buf, top: Math.round(cy - mark.height / 2), left: Math.round(cx - mark.width / 2) });
  }

  return sharp(Buffer.from(svg)).composite(composites).png().toBuffer();
}

module.exports = { buildQrisCard };
