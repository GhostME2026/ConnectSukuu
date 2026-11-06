// Central plan catalogue used by signup, branch management and student enrolment.
const PLAN_LIMITS = Object.freeze({
  starter: Object.freeze({ label: 'Starter', maxStudents: 200, maxBranches: 1 }),
  standard: Object.freeze({ label: 'Standard', maxStudents: 550, maxBranches: 1 }),
  growth: Object.freeze({ label: 'Growth', maxStudents: 1200, maxBranches: 3 }),
  network: Object.freeze({ label: 'Network', maxStudents: Infinity, maxBranches: Infinity }),
});

function getPlanLimits(plan) {
  return PLAN_LIMITS[String(plan || 'starter').trim().toLowerCase()] || PLAN_LIMITS.starter;
}

function planFromStudentRange(value) {
  const ranges = {
    '1-200': 'starter',
    '201-550': 'standard',
    '551-1200': 'growth',
    '1201+': 'network',
  };
  return ranges[String(value || '').trim()] || null;
}

module.exports = { PLAN_LIMITS, getPlanLimits, planFromStudentRange };
