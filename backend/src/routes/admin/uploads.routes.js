'use strict';
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const jsQR = require('jsqr');
const { requireAuth } = require('../../auth.middleware');

const router = express.Router();

// Persistent uploads dir (survives deploys — kept OUTSIDE the repo/web root which
// is rsync --delete'd on every deploy). Override with UPLOADS_DIR in .env.
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/var/www/cahayastore/uploads';
const PUBLIC_BASE = process.env.UPLOADS_PUBLIC_BASE || 'https://api.cahayastore.me/uploads';

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

// Per-context output sizing. Square for product/category cards, wide for banners.
const PRESETS = {
  product:  { width: 800,  height: 800,  fit: 'cover' },
  category: { width: 400,  height: 400,  fit: 'cover' },
  banner:   { width: 1600, height: 600,  fit: 'cover' },
  default:  { width: 1200, height: 1200, fit: 'inside' },
  // Barcode/voucher images must stay crisp & scannable: lossless PNG, no
  // shrinking below original, flattened on white so transparent edges scan.
  barcode:  { width: 1600, height: 1600, fit: 'inside', lossless: true },
};

// Keep raw bytes in memory; sharp compresses to disk as WebP.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // accept up to 8MB raw; output is compressed
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    cb(new Error('Tipe file tidak didukung. Gunakan JPG, PNG, WEBP, GIF, atau AVIF.'));
  },
});

// POST /api/admin/uploads?preset=product|category|banner  (multipart, field: "file")
router.post('/uploads', requireAuth(['owner', 'admin']), (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      const code = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(code).json({ success: false, message: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'File wajib diunggah (field "file").' });
    }
    try {
      const presetKey = String(req.query.preset || '').toLowerCase();
      const preset = PRESETS[presetKey] || PRESETS.default;

      // Lossless presets (barcode) output PNG to preserve sharp bars; everything
      // else outputs compressed WebP.
      const ext = preset.lossless ? '.png' : '.webp';
      const filename = crypto.randomBytes(16).toString('hex') + ext;
      const outPath = path.join(UPLOADS_DIR, filename);

      let pipeline = sharp(req.file.buffer, { animated: !preset.lossless })
        .rotate() // respect EXIF orientation
        .resize({
          width: preset.width,
          height: preset.height,
          fit: preset.fit,
          withoutEnlargement: true,
        });
      if (preset.lossless) {
        // Flatten transparency onto white so scanners see clean black-on-white.
        pipeline = pipeline.flatten({ background: '#ffffff' }).png({ compressionLevel: 9 });
      } else {
        pipeline = pipeline.webp({ quality: 80, effort: 4 });
      }
      await pipeline.toFile(outPath);

      const { size } = fs.statSync(outPath);
      const url = `${PUBLIC_BASE}/${filename}`;
      res.status(201).json({ success: true, url, filename, size });
    } catch (e) {
      console.error('[uploads]', e);
      res.status(422).json({ success: false, message: 'Gagal memproses gambar.' });
    }
  });
});

// POST /api/admin/uploads/decode-qris  (multipart, field: "file")
// Reads a QR image and returns the embedded EMV/QRIS string.
const decodeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    cb(new Error('Tipe file tidak didukung. Unggah foto/PNG QRIS.'));
  },
});

router.post('/uploads/decode-qris', requireAuth(['owner', 'admin']), (req, res) => {
  decodeUpload.single('file')(req, res, async (err) => {
    if (err) {
      const code = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(code).json({ success: false, message: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'File QRIS wajib diunggah.' });
    }
    try {
      // Normalize: upscale a bit + grayscale-friendly raw RGBA for the QR reader.
      const MAX = 1000;
      const { data, info } = await sharp(req.file.buffer)
        .rotate()
        .resize({ width: MAX, height: MAX, fit: 'inside', withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const result = jsQR(new Uint8ClampedArray(data.buffer), info.width, info.height);
      if (!result || !result.data) {
        return res.status(422).json({ success: false, message: 'QR tidak terbaca. Pakai foto yang jelas & tegak lurus.' });
      }
      const qris = String(result.data).trim();
      // Basic sanity: EMV QRIS starts with "0002" payload format indicator.
      if (!/^00\d{2}/.test(qris)) {
        return res.status(422).json({ success: false, message: 'QR terbaca tapi bukan format QRIS yang valid.', raw: qris });
      }
      res.json({ success: true, qris });
    } catch (e) {
      console.error('[decode-qris]', e);
      res.status(422).json({ success: false, message: 'Gagal membaca gambar QRIS.' });
    }
  });
});

module.exports = router;
