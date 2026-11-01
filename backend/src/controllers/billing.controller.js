const Stripe = require('stripe');
const prisma = require('../config/db');
const { addPeriod } = require('../utils/trial');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Prices in the smallest currency unit — pesewas for GHS, cents for USD.
// One-time prices are a placeholder heuristic (~ roughly 18 months of the
// monthly price) — swap in whatever number you actually decide on.
// All provider amounts are stored in the provider's smallest currency unit:
// Paystack GHS values are pesewas; Stripe USD values are cents.
// Public pricing: Starter GHS 160/month equivalent yearly, Growth GHS 480/month equivalent yearly.
const PLAN_PRICES = {
  starter: {
    yearly:  { ghs: 192000, usd: 18800 }, // GHS 1,920 / USD 188 per year
    onetime: { ghs: 320000, usd: 28500 }, // GHS 3,200 / USD 285 once
  },
  growth: {
    yearly:  { ghs: 576000, usd: 51000 }, // GHS 5,760 / USD 510 per year
    onetime: { ghs: 730000, usd: 70000 }, // GHS 7,300 / USD 700 once
  },
};

function getPrice(plan, billingCycle) {
  const plans = PLAN_PRICES[plan];
  if (!plans) return null;
  const key = billingCycle === 'ONE_TIME' ? 'onetime' : billingCycle === 'YEARLY' ? 'yearly' : 'monthly';
  return plans[key];
}

// GET /api/billing/prices — public checkout totals in major currency units.
function getPublicPrices(_req, res) {
  const result = {};
  for (const [plan, cycles] of Object.entries(PLAN_PRICES)) {
    result[plan] = {};
    for (const [cycle, price] of Object.entries(cycles)) {
      result[plan][cycle === 'onetime' ? 'ONE_TIME' : 'YEARLY'] = {
        GHS: price.ghs / 100,
        USD: price.usd / 100,
      };
    }
  }
  return res.json(result);
}

// ---------- Paystack (Mobile Money + Ghanaian cards) ----------
//
// Note on recurring billing via Paystack: Paystack's MoMo channel doesn't
// support silently auto-charging a customer the way a card subscription
// does. So MONTHLY/YEARLY plans paid via Paystack are "pay for a period,
// then pay again when it ends" (the same pattern lardigh.com uses, billing
// per term) rather than a true auto-renewing subscription. `subscriptionRenewsAt`
// is what tracks that period; nothing auto-charges the school when it passes,
// so add a scheduled reminder (email/SMS) as a next step — flagged in GUIDE.md.

// POST /api/billing/paystack/initialize   body: { plan, billingCycle: 'ONE_TIME'|'MONTHLY'|'YEARLY' }
async function initializePaystack(req, res) {
  const { plan, billingCycle } = req.body;
  const price = getPrice(plan, billingCycle);
  if (!price) return res.status(400).json({ error: 'Unknown plan or billing cycle' });

  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: req.user.email,
      amount: price.ghs,
      currency: 'GHS',
      metadata: { schoolId: req.user.schoolId, plan, billingCycle },
      callback_url: `${process.env.FRONTEND_URL}/billing-success.html`,
    }),
  });

  const data = await response.json();
  if (!data.status) return res.status(400).json({ error: data.message });

  await prisma.payment.create({
    data: {
      schoolId: req.user.schoolId,
      provider: 'PAYSTACK',
      billingCycle,
      reference: data.data.reference,
      amount: price.ghs,
      currency: 'GHS',
      status: 'pending',
    },
  });

  res.json({ authorizationUrl: data.data.authorization_url });
}

// POST /api/billing/paystack/webhook
// Configure this exact URL in your Paystack dashboard under Settings > API Keys & Webhooks.
// In production, verify the `x-paystack-signature` header (see GUIDE.md) before trusting this body.
async function paystackWebhook(req, res) {
  const event = req.body;

  if (event.event === 'charge.success') {
    const { reference, metadata } = event.data;
    const { schoolId, plan, billingCycle } = metadata;

    await prisma.payment.update({ where: { reference }, data: { status: 'success' } });

    await prisma.school.update({
      where: { id: schoolId },
      data: {
        subscriptionStatus: 'ACTIVE',
        plan,
        billingProvider: 'PAYSTACK',
        billingCycle,
        subscriptionRenewsAt: billingCycle === 'ONE_TIME' ? null : addPeriod(billingCycle),
      },
    });
  }

  res.sendStatus(200);
}

// ---------- Stripe (international cards) ----------

// POST /api/billing/stripe/checkout   body: { plan, billingCycle: 'ONE_TIME'|'MONTHLY'|'YEARLY' }
async function createStripeCheckout(req, res) {
  const { plan, billingCycle } = req.body;
  const price = getPrice(plan, billingCycle);
  if (!price) return res.status(400).json({ error: 'Unknown plan or billing cycle' });

  const isOneTime = billingCycle === 'ONE_TIME';

  const session = await stripe.checkout.sessions.create({
    mode: isOneTime ? 'payment' : 'subscription',
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        unit_amount: price.usd,
        ...(isOneTime ? {} : { recurring: { interval: billingCycle === 'YEARLY' ? 'year' : 'month' } }),
        product_data: { name: `ConnectSukuu — ${plan} plan (${billingCycle.toLowerCase()})` },
      },
      quantity: 1,
    }],
    metadata: { schoolId: req.user.schoolId, plan, billingCycle },
    success_url: `${process.env.FRONTEND_URL}/billing-success.html`,
    cancel_url: `${process.env.FRONTEND_URL}/pricing.html`,
  });

  res.json({ url: session.url });
}

// POST /api/billing/stripe/webhook
// Stripe requires the RAW request body to verify its signature — see the note in index.js.
async function stripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { schoolId, plan, billingCycle } = session.metadata;

    await prisma.school.update({
      where: { id: schoolId },
      data: {
        subscriptionStatus: 'ACTIVE',
        plan,
        billingProvider: 'STRIPE',
        billingCycle,
        // For real Stripe subscriptions, Stripe itself tracks renewal —
        // subscriptionRenewsAt stays null and future invoice events (below)
        // are what should flip status if a card payment ever fails.
      },
    });
  }

  // Stripe-managed subscriptions: react to renewal failures/cancellations automatically.
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    const schoolId = invoice.subscription_details?.metadata?.schoolId;
    if (schoolId) {
      await prisma.school.update({ where: { id: schoolId }, data: { subscriptionStatus: 'PAST_DUE' } });
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const schoolId = sub.metadata?.schoolId;
    if (schoolId) {
      await prisma.school.update({ where: { id: schoolId }, data: { subscriptionStatus: 'CANCELED' } });
    }
  }

  res.sendStatus(200);
}

module.exports = { getPublicPrices, initializePaystack, paystackWebhook, createStripeCheckout, stripeWebhook };
