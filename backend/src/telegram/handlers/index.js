'use strict';
/* Registers all modular bot handlers. */
const { registerStartHandlers } = require('./start');
const { registerCategoryHandlers } = require('./category');
const { registerProductHandlers } = require('./product');
const { registerBuyHandlers } = require('./buy');
const { registerOrdersHandlers } = require('./orders');
const { registerTopupHandlers } = require('./topup');
const { registerProfileHandlers } = require('./profile');
const { registerReferralHandlers } = require('./referral');
const { registerPromoHandlers } = require('./promo');
const { registerHelpHandlers } = require('./help');
const { registerComingSoonHandlers } = require('./coming-soon');

function registerHandlers(bot, opts = {}) {
  // Order matters: specific commands before catch-alls.
  registerStartHandlers(bot, opts);
  registerCategoryHandlers(bot, opts);
  registerProductHandlers(bot, opts);
  registerBuyHandlers(bot, opts);
  registerOrdersHandlers(bot, opts);
  registerTopupHandlers(bot, opts);
  registerProfileHandlers(bot, opts);
  registerReferralHandlers(bot, opts);
  registerPromoHandlers(bot, opts);
  registerHelpHandlers(bot, opts);
  registerComingSoonHandlers(bot, opts);
}

module.exports = { registerHandlers };
