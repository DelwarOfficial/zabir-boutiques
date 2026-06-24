/**
 * Coupon Brute-Force Protection [Master_Prompt v7.0 §9.2]
 *
 * Rate limit coupon attempts to 5/min per session. Lock the session
 * for 30 minutes after 5 failed attempts. Tracked in D1
 * `coupon_brute_force` table so admins can audit.
 */
import { nowSql } from "./dates";

const MAX_FAILURES = 5;
const LOCKOUT_SECONDS = 30 * 60;

export interface CouponAttemptResult {
  allowed: boolean;
  failures: number;
  lockedUntil?: string;
}

export async function checkCouponRateLimit(db: D1Database, sessionId: string): Promise<CouponAttemptResult> {
  const now = nowSql();
  const row = await db
    .prepare("SELECT failed_attempts, locked_until FROM coupon_brute_force WHERE session_id = ?1")
    .bind(sessionId)
    .first<{ failed_attempts: number; locked_until: string | null }>();
  if (!row) return { allowed: true, failures: 0 };
  if (row.locked_until && row.locked_until > now) {
    return { allowed: false, failures: row.failed_attempts, lockedUntil: row.locked_until };
  }
  return { allowed: true, failures: row.failed_attempts };
}

export async function recordCouponFailure(db: D1Database, sessionId: string, _code: string): Promise<CouponAttemptResult> {
  const now = nowSql();
  const row = await db
    .prepare("SELECT failed_attempts FROM coupon_brute_force WHERE session_id = ?1")
    .bind(sessionId)
    .first<{ failed_attempts: number }>();
  const next = (row?.failed_attempts ?? 0) + 1;
  const locked = next >= MAX_FAILURES;
  const lockedUntil = locked ? nowSql(new Date(Date.now() + LOCKOUT_SECONDS * 1000)) : null;
  await db
    .prepare(
      `INSERT INTO coupon_brute_force (session_id, failed_attempts, locked_until, last_attempt_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(session_id) DO UPDATE SET
         failed_attempts = excluded.failed_attempts,
         locked_until = excluded.locked_until,
         last_attempt_at = excluded.last_attempt_at`,
    )
    .bind(sessionId, next, lockedUntil, now)
    .run();
  return { allowed: !locked, failures: next, lockedUntil: lockedUntil ?? undefined };
}

export async function clearCouponFailures(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare("DELETE FROM coupon_brute_force WHERE session_id = ?1").bind(sessionId).run();
}
