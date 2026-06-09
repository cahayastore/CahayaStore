'use strict';
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { requireAuth } = require('../../auth.middleware');

const router = express.Router();

// Persistent uploads dir (survives deploys — kept OUTSIDE the repo/web root which
// is rsync --delete'd on every deploy). Override with UPLOADS_DIR in .env.
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/var/www/cahayastore/uploads';
const PUBLIC_BASE = process.env.UPLOADS_PUBLIC_BASE || 'https://api.cahayastore.me/uploads';

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = EXT[file.mimetype] || path.extname(file.originalname).toLowerCase() || '.bin';
    const name = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB (nginx client_max_body_size is 5m)
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    cb(new Error('Tipe file tidak didukung. Gunakan JPG, PNG, WEBP, GIF, atau AVIF.'));
  },
});

// POST /api/admin/uploads  (multipart/form-data, field: "file")
router.post('/uploads', requireAuth(['owner', 'admin']), (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const code = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(code).json({ success: false, message: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'File wajib diunggah (field "file").' });
    }
    const url = `${PUBLIC_BASE}/${req.file.filename}`;
    res.status(201).json({ success: true, url, filename: req.file.filename, size: req.file.size });
  });
});

module.exports = router;
