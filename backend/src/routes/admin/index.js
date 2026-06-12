'use strict';
const express = require('express');
const { requireAuth } = require('../../auth.middleware');

const router = express.Router();
router.use(requireAuth(['owner', 'admin']));

router.use(require('./ui.routes'));
router.use(require('./dashboard.routes'));
router.use(require('./products.routes'));
router.use(require('./stocks.routes'));
router.use(require('./categories.routes'));
router.use(require('./orders.routes'));
router.use(require('./settings.routes'));
router.use(require('./uploads.routes'));

module.exports = router;
