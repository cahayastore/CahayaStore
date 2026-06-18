'use strict';
/* Branded QRIS card generator — "Scan Me" style.
   Renders a clean card: Cahaya Store logo, a standard black QR inside blue
   corner brackets (scan frame), and a rounded label box below the QR carrying
   the ORDER NUMBER (where a "Scan Me" label normally sits).
   Returns a PNG Buffer suitable for ctx.replyWithPhoto(new InputFile(buf)). */
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const sharp = require('sharp');

const LOGO_CANDIDATES = [
  '/var/www/cahayastore/store/assets/logo-light.png',
  '/var/www/cahayastore/store/assets/logo.png',
  path.join(__dirname, '..', 'admin-panel', 'assets', 'logo.png'),
];

const QR_DARK = '#1f2430';   // near-black QR modules (like the reference)
const ACCENT = '#15a3e6';    // blue brackets + label box (like the reference)
let _logoCache;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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

/* Blue corner brackets (scan-frame) around the QR. */
function cornerBrackets(x, y, size, t, len, col) {
  const r = 18; // corner radius
  const p = (a, b) => `${a.toFixed(1)},${b.toFixed(1)}`;
  // Each corner is an L-shaped rounded path.
  const tl = `M ${p(x, y + len)} L ${p(x, y + r)} Q ${p(x, y)} ${p(x + r, y)} L ${p(x + len, y)}`;
  const tr = `M ${p(x + size - len, y)} L ${p(x + size - r, y)} Q ${p(x + size, y)} ${p(x + size, y + r)} L ${p(x + size, y + len)}`;
  const bl = `M ${p(x, y + size - len)} L ${p(x, y + size - r)} Q ${p(x, y + size)} ${p(x + r, y + size)} L ${p(x + len, y + size)}`;
  const br = `M ${p(x + size - len, y + size)} L ${p(x + size - r, y + size)} Q ${p(x + size, y + size)} ${p(x + size, y + size - r)} L ${p(x + size, y + size - len)}`;
  const style = `fill="none" stroke="${col}" stroke-width="${t}" stroke-linecap="round"`;
  return `<path d="${tl}" ${style}/><path d="${tr}" ${style}/><path d="${bl}" ${style}/><path d="${br}" ${style}/>`;
}

/* Build the QR card PNG.
   opts: { qrisData, orderNo, amount, subtitle } — amount/subtitle now go in the
   caption text, so the image focuses on the QR + order label. */
async function buildQrisCard({ qrisData, orderNo = '', amount = 0, subtitle = '' }) {
  const W = 540;
  const qrPx = 340;          // actual QR drawing area
  const logoW = 260;

  const logo = await getLogo(logoW);
  const logoTop = 30;
  const logoH = logo ? logo.height : 0;

  // Scan-frame geometry.
  const frameGap = 26;                 // gap between QR and brackets
  const bracketLen = 54;
  const bracketT = 9;
  const frameStart = logoTop + logoH + 24;
  const qrX = Math.round((W - qrPx) / 2);
  const qrY = frameStart + frameGap;
  const frameX = qrX - frameGap;
  const frameY = qrY - frameGap;
  const frameSize = qrPx + frameGap * 2;
  const H = frameY + frameSize + 34;

  // Standard QR as PNG (black on white). High EC so the center order-id overlay
  // doesn't break scanning.
  const qrBuf = await QRCode.toBuffer(String(qrisData), {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: qrPx,
    color: { dark: QR_DARK + 'ff', light: '#ffffffff' },
  });

  // Center order-id plate geometry.
  const cx = qrX + qrPx / 2;
  const cy = qrY + qrPx / 2;
  const idText = orderNo ? String(orderNo) : '';
  const plateW = Math.max(96, idText.length * 13 + 30);
  const plateH = 40;

  const svg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#f1f3f5"/>
  ${cornerBrackets(frameX, frameY, frameSize, bracketT, bracketLen, ACCENT)}
</svg>`;

  const composites = [{ input: qrBuf, top: qrY, left: qrX }];
  if (logo) composites.unshift({ input: logo.buf, top: logoTop, left: Math.round((W - logo.width) / 2) });

  // Order id plate, composited ON TOP of the QR center.
  if (idText) {
    const plate = await sharp(Buffer.from(
      `<svg width="${Math.ceil(plateW)}" height="${plateH}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="${Math.ceil(plateW)}" height="${plateH}" rx="12" fill="#ffffff" stroke="${ACCENT}" stroke-width="3"/>` +
      `<text x="${(plateW / 2).toFixed(1)}" y="${(plateH / 2 + 6).toFixed(1)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="bold" letter-spacing="0.5" fill="${QR_DARK}">${esc(idText)}</text>` +
      `</svg>`
    )).png().toBuffer();
    composites.push({ input: plate, top: Math.round(cy - plateH / 2), left: Math.round(cx - plateW / 2) });
  }

  return sharp(Buffer.from(svg)).composite(composites).png().toBuffer();
}

module.exports = { buildQrisCard };
