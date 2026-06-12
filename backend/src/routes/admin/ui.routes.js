'use strict';
const express = require('express');
const path = require('path');

const router = express.Router();

// Serve bot settings admin UI
router.get('/ui/bot-settings', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../../admin/bot-settings.html'));
});

module.exports = router;
