'use strict';
/* Branded QRIS card generator.
   Renders a clean card: header (store name), order number, a BLUE QR code,
   total amount, and an optional subtitle (product / "Top Up Saldo").
   Returns a PNG Buffer suitable for ctx.replyWithPhoto(new InputFile(buf)). */
const QRCode = require('qrcode');
const sharp = require('sharp');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function rupiah(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
}

/* Generate the QR as blue modules on transparent/white, returned as PNG buffer. */
async function makeBlueQr(data, size = 560) {
  return QRCode.toBuffer(String(data), {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: size,
    color: {
      dark: '#1d4ed8ff',   // blue modules
      light: '#ffffffff',  // white background
    },
  });
}

/* Build the full branded card PNG.
   opts: { qrisData, title, orderNo, amount, subtitle, storeName } */
async function buildQrisCard({ qrisData, title = 'Pembayaran QRIS', orderNo = '', amount = 0, subtitle = '', storeName = 'Cahaya Store' }) {
  const W = 760;
  const H = 1120;
  const qrSize = 520;
  const qrBuf = await makeBlueQr(qrisData, qrSize);

  // Card background + framing + texts via SVG, then composite the QR PNG.
  const qrX = Math.round((W - qrSize) / 2);
  const qrY = 286;

  const svg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#eff4ff"/>
      <stop offset="1" stop-color="#dbe7ff"/>
    </linearGradient>
    <linearGradient id="hdr" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#1d4ed8"/>
      <stop offset="1" stop-color="#2563eb"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="16" flood-color="#1d4ed8" flood-opacity="0.18"/>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- Card -->
  <rect x="40" y="40" width="${W - 80}" height="${H - 80}" rx="28" fill="#ffffff" filter="url(#shadow)"/>

  <!-- Header bar -->
  <rect x="40" y="40" width="${W - 80}" height="120" rx="28" fill="url(#hdr)"/>
  <rect x="40" y="120" width="${W - 80}" height="40" fill="url(#hdr)"/>
  <text x="${W / 2}" y="118" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="bold" fill="#ffffff">${esc(storeName)}</text>

  <!-- Title + order -->
  <text x="${W / 2}" y="210" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="bold" fill="#0f172a">${esc(title)}</text>
  ${orderNo ? `<text x="${W / 2}" y="244" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="20" fill="#64748b">Order: ${esc(orderNo)}</text>` : ''}

  <!-- QR frame -->
  <rect x="${qrX - 16}" y="${qrY - 16}" width="${qrSize + 32}" height="${qrSize + 32}" rx="20" fill="#ffffff" stroke="#dbeafe" stroke-width="3"/>

  <!-- Amount -->
  <text x="${W / 2}" y="${qrY + qrSize + 74}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="#64748b">Bayar TEPAT</text>
  <text x="${W / 2}" y="${qrY + qrSize + 126}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="bold" fill="#1d4ed8">${esc(rupiah(amount))}</text>
  ${subtitle ? `<text x="${W / 2}" y="${qrY + qrSize + 168}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" fill="#334155">${esc(subtitle)}</text>` : ''}

  <!-- Footer -->
  <text x="${W / 2}" y="${H - 64}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" fill="#94a3b8">Scan dengan aplikasi e-wallet / m-banking</text>
</svg>`;

  const base = Buffer.from(svg);
  return sharp(base)
    .composite([{ input: qrBuf, top: qrY, left: qrX }])
    .png()
    .toBuffer();
}

module.exports = { buildQrisCard };
