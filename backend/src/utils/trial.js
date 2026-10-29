function thirtyDaysFromNow() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d;
}

function addPeriod(cycle) {
  const d = new Date();
  if (cycle === 'YEARLY') d.setFullYear(d.getFullYear() + 1);
  else d.setDate(d.getDate() + 30); // MONTHLY
  return d;
}

// A school can use the app if:
//  - it paid ONE_TIME (permanent access — subscriptionRenewsAt is ignored), or
//  - it's on a MONTHLY/YEARLY plan and hasn't passed its renewal date, or
//  - it's still inside its original 30-day trial window and never paid.
function schoolHasAccess(school) {
  // A Super Admin-granted exemption is an explicit access entitlement for a
  // demo/internal school. It is not a payment and does not alter billing status.
  if (school.subscriptionExempt === true) return true;

  if (school.subscriptionStatus === 'ACTIVE') {
    if (school.billingCycle === 'ONE_TIME') return true;
    if (school.subscriptionRenewsAt) return new Date() < new Date(school.subscriptionRenewsAt);
    return true; // Stripe-managed subscription with no manual renewsAt tracking — trust the webhook-set status
  }
  if (school.subscriptionStatus === 'TRIALING' && new Date() < new Date(school.trialEndsAt)) {
    return true;
  }
  return false;
}

module.exports = { thirtyDaysFromNow, addPeriod, schoolHasAccess };
