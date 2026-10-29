'use strict';

/**
 * Enforces one ENTRY and one EXIT per student, school-local calendar day.
 * The application currently operates in Ghana (Africa/Accra, UTC+0). Keep the
 * timezone explicit so a future multi-timezone deployment can replace this
 * with the school's configured timezone.
 */
const SCHOOL_TIME_ZONE = 'Africa/Accra';

function schoolLocalDayRange(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid gate timestamp.');
  // Africa/Accra is UTC+0, so the school-local calendar day equals the UTC day.
  // This is explicit rather than dependent on the server's local timezone.
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return { start, end: new Date(start.getTime() + 86400000), dayKey: start.toISOString().slice(0, 10) };
}

async function assertGateTransition(tx, { schoolId, studentId, eventType, occurredAt }) {
  const { start, end, dayKey } = schoolLocalDayRange(occurredAt);

  // Transaction-scoped PostgreSQL lock serializes attempts across processes/users.
  // The stable school/student/day key prevents concurrent requests racing the check.
  // Return a scalar value instead of the PostgreSQL `void` result. Prisma's
  // $queryRaw cannot reliably deserialize a bare void column; that made every
  // gate save fail before the duplicate checks could run. The subquery still
  // executes the transaction-scoped lock, while the outer query returns boolean.
  await tx.$queryRaw`
    WITH lock_result AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(
        hashtext(${`${schoolId}:${studentId}`}),
        hashtext(${dayKey})
      )
    )
    SELECT TRUE AS locked FROM lock_result
  `;

  const sameType = await tx.studentGateLog.findFirst({
    where: { schoolId, studentId, eventType, occurredAt: { gte: start, lt: end } },
    select: { id: true }
  });
  if (sameType) {
    const error = new Error(
      `A student can have only one ${eventType === 'ENTRY' ? 'entry' : 'exit'} record per school day (${dayKey}).`
    );
    error.status = 409;
    throw error;
  }

  if (eventType === 'EXIT') {
    const entry = await tx.studentGateLog.findFirst({
      where: { schoolId, studentId, eventType: 'ENTRY', occurredAt: { gte: start, lt: end } },
      select: { id: true }
    });
    if (!entry) {
      const error = new Error('Record the student’s entry for this school day before recording an exit.');
      error.status = 409;
      throw error;
    }
  }
}

module.exports = { assertGateTransition, schoolLocalDayRange, SCHOOL_TIME_ZONE };
