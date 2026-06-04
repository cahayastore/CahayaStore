'use strict';
const express = require('express');
const { getSetting, setSetting, listSettings, KEYS } = require('../../settings.service');

const router = express.Router();

router.get('/settings', async (_req, res) => {
  res.json({ success: true, data: await listSettings(), known_keys: KEYS });
});

router.get('/settings/:key', async (req, res) => {
  const v = await getSetting(req.params.key);
  res.json({ success: true, key: req.params.key, value: v });
});

router.put('/settings/:key', async (req, res) => {
  const { value, secret } = req.body || {};
  if (value === undefined) {
    return res.status(400).json({ success: false, message: 'value required' });
  }
  await setSetting(req.params.key, value, { secret: !!secret });
  res.json({ success: true, key: req.params.key });
});

module.exports = router;
