'use strict';
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
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
      const filename = crypto.randomBytes(16).toString('hex') + '.webp';
      const outPath = path.join(UPLOADS_DIR, filename);

      await sharp(req.file.buffer, { animated: true })
        .rotate() // respect EXIF orientation
        .resize({
          width: preset.width,
          height: preset.height,
          fit: preset.fit,
          withoutEnlargement: true,
        })
        .webp({ quality: 80, effort: 4 })
        .toFile(outPath);

      const { size } = fs.statSync(outPath);
      const url = `${PUBLIC_BASE}/${filename}`;
      res.status(201).json({ success: true, url, filename, size });
    } catch (e) {
      console.error('[uploads]', e);
      res.status(422).json({ success: false, message: 'Gagal memproses gambar.' });
    }
  });
});

module.exports = router;
