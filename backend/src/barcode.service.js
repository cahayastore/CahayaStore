'use strict';
/* ════════════════════════════════════════════════════════════════════
   Barcode render service.
   Turns a stored barcode VALUE (text/number) into a scannable PNG using
   bwip-js. Used when delivering 'barcode' stock to a buyer.

   Symbologies:
     code128 — general 1D (vouchers, receipts). Default.
     ean13   — 13-digit retail product codes.
     qrcode  — 2D QR.
     auto    — pick ean13 for valid 13-digit numerics, else code128.
   ════════════════════════════════════════════════════════════════════ */
const bwipjs = require('bwip-js');

const SYMBOLOGIES = new Set(['code128', 'ean13', 'qrcode', 'auto']);

function normalizeSymbology(s) {
  const v = String(s || '').toLowerCase().trim();
  return SYMBOLOGIES.has(v) ? v : 'code128';
}

/* Resolve 'auto' to a concrete bwip-js bcid based on the value shape. */
function resolveBcid(symbology, value) {
  const sym = normalizeSymbology(symbology);
  if (sym !== 'auto') return sym;
  const digits = String(value || '').replace(/\s+/g, '');
  if (/^\d{13}$/.test(digits)) return 'ean13';
  if (/^\d{12}$/.test(digits)) return 'ean13'; // bwip-js adds the check digit
  return 'code128';
}

/* Render a barcode value to a PNG Buffer. Throws on invalid input.
   If EAN-13 fails (e.g. bad check digit), falls back to Code128 so the buyer
   still gets a scannable barcode of the raw value. */
async function renderBarcodePng(value, symbology = 'code128') {
  const text = String(value || '').trim();
  if (!text) throw new Error('Barcode value kosong');
  const bcid = resolveBcid(symbology, text);

  const build = (id) => {
    const opts = {
      bcid: id,
      text: id === 'ean13' ? text.replace(/\s+/g, '') : text,
      scale: 4,
      includetext: true,
      textxalign: 'center',
      paddingwidth: 10,
      paddingheight: 10,
      backgroundcolor: 'FFFFFF',
    };
    // 1D codes get an explicit bar height; QR is square and ignores height.
    if (id !== 'qrcode') opts.height = 16;
    return opts;
  };

  try {
    return await bwipjs.toBuffer(build(bcid));
  } catch (e) {
    if (bcid === 'ean13') {
      // Invalid EAN-13 (e.g. wrong check digit) → render the raw value as Code128.
      return bwipjs.toBuffer(build('code128'));
    }
    throw e;
  }
}

module.exports = { renderBarcodePng, normalizeSymbology, resolveBcid, SYMBOLOGIES };
