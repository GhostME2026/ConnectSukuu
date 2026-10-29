const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const {
  initializePaystack,
  paystackWebhook,
  createStripeCheckout,
  stripeWebhook,
} = require('../controllers/billing.controller');

// These need login (the owner is paying) but NOT requireActiveSubscription —
// that would lock a school out of the one page that lets it pay to get back in.
router.post('/paystack/initialize', requireAuth, initializePaystack);
router.post('/stripe/checkout', requireAuth, createStripeCheckout);

// Webhooks are called by Paystack/Stripe's own servers, not by a logged-in user —
// no requireAuth here. Security instead comes from signature verification.
// NOTE: the Stripe webhook route is registered separately in index.js (before
// express.json()) because Stripe needs the raw request body — it is NOT
// duplicated here to avoid two handlers competing for the same path.
router.post('/paystack/webhook', paystackWebhook);

module.exports = router;
