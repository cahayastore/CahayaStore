'use strict';
/* Branded QRIS card generator — marketku.id style.
   A dark navy card with a rounded white QR panel (quiet zone), a grey→black
   diagonal-gradient QR, the ORDER ID badge centered inside the QR (navy + white
   ring), a "SCAN ME" pill at the bottom-left edge, the product name below in
   white, and the store logo on top.
   Returns a PNG Buffer for ctx.replyWithPhoto(new InputFile(buf)). */
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const sharp = require('sharp');

const LOGO_CANDIDATES = [
  '/var/www/cahayastore/store/assets/logo-light.png',
  '/var/www/cahayastore/store/assets/logo.png',
  path.join(__dirname, '..', 'admin-panel', 'assets', 'logo.png'),
];

const CARD_BG = '#0F1A2E';      // dark navy card (marketku)
const QR_GREY = '#393e46';      // gradient start (dark grey)
const QR_BLACK = '#0c1016';     // gradient end (near-black)
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

/* Build a grey→black diagonal-gradient QR (PNG buffer, transparent background)
   by masking a gradient with the QR modules. errorCorrectionLevel H so the
   centered order-id badge stays scannable. */
async function buildGradientQr(qrisData, size) {
  // 1) QR modules as black on transparent.
  const qrPng = await QRCode.toBuffer(String(qrisData), {
    errorCorrectionLevel: 'H',
    margin: 0,
    width: size,
    color: { dark: '#000000ff', light: '#00000000' },
  });
  // 2) Diagonal grey→black gradient at the same size.
  const gradient = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${QR_GREY}"/><stop offset="1" stop-color="${QR_BLACK}"/>` +
    `</linearGradient></defs>` +
    `<rect width="${size}" height="${size}" fill="url(#g)"/></svg>`
  );
  // 3) Keep gradient only where QR modules are (use QR as alpha mask).
  return sharp(gradient)
    .composite([{ input: qrPng, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

/* Build the QR card PNG. opts: { qrisData, orderNo, amount, subtitle }.
   amount/subtitle go in the caption text; the card focuses on QR + order id +
   product name. */
async function buildQrisCard({ qrisData, orderNo = '', amount = 0, subtitle = '' }) {
  const W = 600;
  const padX = 40;
  const logoW = 240;
  const logo = await getLogo(logoW);

  // Layout.
  const topPad = 34;
  const logoH = logo ? logo.height : 0;
  const logoGap = logo ? 24 : 0;

  const cardX = 28;
  const cardW = W - cardX * 2;
  const cardRadius = 36;
  const cardPad = 26;          // dark border around the white panel
  const qrPanelPad = 22;       // white quiet zone around the QR
  const qrSize = cardW - (cardPad + qrPanelPad) * 2;

  const productName = (subtitle || '').trim();
  const productGap = 34;
  const productH = productName ? 30 : 0;

  const cardTopY = topPad + (logo ? logoH + logoGap : 0);
  const panelW = qrSize + qrPanelPad * 2;
  const panelH = panelW;
  const cardH = cardPad + panelH + (productName ? productGap + productH : 0) + cardPad;
  const H = cardTopY + cardH + 30;

  const panelX = cardX + cardPad;
  const panelY = cardTopY + cardPad;
  const qrX = panelX + qrPanelPad;
  const qrY = panelY + qrPanelPad;
  const cx = qrX + qrSize / 2;
  const cy = qrY + qrSize / 2;

  // Order-id badge geometry (centered on QR).
  const idText = orderNo ? `#${orderNo}` : '';
  const badgeH = 44;
  const badgeW = Math.min(Math.max(110, idText.length * 13 + 28), qrSize * 0.64);
  const ringPad = 7;

  // "SCAN ME" pill (bottom-left edge of the card).
  const pillH = 40;
  const pillText = 'SCAN ME';

  const svg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="none" stroke="#e2e8f0" stroke-width="2"/>

  <!-- Dark navy card -->
  <rect x="${cardX}" y="${cardTopY}" width="${cardW}" height="${cardH}" rx="${cardRadius}" fill="${CARD_BG}"/>

  <!-- White QR quiet-zone panel -->
  <rect x="${panelX}" y="${panelY}" width="${panelW}" height="${panelH}" rx="20" fill="#ffffff"/>

  ${idText ? `
  <!-- Order id badge centered in QR -->
  <rect x="${(cx - badgeW / 2 - ringPad).toFixed(1)}" y="${(cy - badgeH / 2 - ringPad).toFixed(1)}" width="${(badgeW + ringPad * 2).toFixed(1)}" height="${(badgeH + ringPad * 2).toFixed(1)}" rx="${(badgeH / 2 + ringPad).toFixed(1)}" fill="#ffffff"/>
  <rect x="${(cx - badgeW / 2).toFixed(1)}" y="${(cy - badgeH / 2).toFixed(1)}" width="${badgeW.toFixed(1)}" height="${badgeH}" rx="${badgeH / 2}" fill="${CARD_BG}"/>
  <text x="${cx.toFixed(1)}" y="${(cy + 1).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="bold" fill="#ffffff">${esc(idText)}</text>
  ` : ''}

  <!-- SCAN ME pill at bottom-left edge of the card -->
  <g>
    <rect x="${(panelX + 4).toFixed(1)}" y="${(cardTopY + cardH - pillH / 2).toFixed(1)}" width="150" height="${pillH}" rx="${pillH / 2}" fill="${CARD_BG}" stroke="#1f2d44" stroke-width="2"/>
    <text x="${(panelX + 4 + 75).toFixed(1)}" y="${(cardTopY + cardH + 1).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="bold" letter-spacing="2" fill="#ffffff">${pillText}</text>
  </g>

  ${productName ? `
  <text x="${W / 2}" y="${(cardTopY + cardPad + panelH + productGap + 4).toFixed(1)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="bold" fill="#ffffff">${esc(productName.length > 38 ? productName.slice(0, 37) + '…' : productName)}</text>
  ` : ''}
</svg>`;

  const qrBuf = await buildGradientQr(qrisData, qrSize);
  const composites = [{ input: qrBuf, top: Math.round(qrY), left: Math.round(qrX) }];
  if (logo) composites.unshift({ input: logo.buf, top: topPad, left: Math.round((W - logo.width) / 2) });

  // Re-draw the order-id badge ON TOP of the QR (SVG badge is under the QR
  // composite, so paint it again as an overlay to stay visible & scannable).
  if (idText) {
    const badge = await sharp(Buffer.from(
      `<svg width="${Math.ceil(badgeW + ringPad * 2)}" height="${badgeH + ringPad * 2}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="${Math.ceil(badgeW + ringPad * 2)}" height="${badgeH + ringPad * 2}" rx="${badgeH / 2 + ringPad}" fill="#ffffff"/>` +
      `<rect x="${ringPad}" y="${ringPad}" width="${Math.ceil(badgeW)}" height="${badgeH}" rx="${badgeH / 2}" fill="${CARD_BG}"/>` +
      `<text x="${(badgeW / 2 + ringPad).toFixed(1)}" y="${(badgeH / 2 + ringPad + 1).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="bold" fill="#ffffff">${esc(idText)}</text>` +
      `</svg>`
    )).png().toBuffer();
    composites.push({ input: badge, top: Math.round(cy - (badgeH + ringPad * 2) / 2), left: Math.round(cx - (badgeW + ringPad * 2) / 2) });
  }

  return sharp(Buffer.from(svg)).composite(composites).png().toBuffer();
}

module.exports = { buildQrisCard };
