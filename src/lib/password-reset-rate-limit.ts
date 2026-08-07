/**
 * Password Reset Rate Limiter
 *
 * D1-based rate limiter for the forgot-password endpoint.
 * Rejects requests from an IP that has exceeded 3 attempts in a
 * rolling 15-minute window.
 */
import { nowSql } from "./dates";

const MAX_ATTEMPTS = 3;
const WINDOW_SECONDS = 15 * 60;

export interface ResetRateLimitResult {
  allowed: boolean;
}

export async function checkResetRateLimit(db: D1Database, ip: string): Promise<ResetRateLimitResult> {
  const cutoff = nowSql(new Date(Date.now() - WINDOW_SECONDS * 1000));
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM password_reset_rate_limits
       WHERE ip_address = ?1 AND attempted_at > ?2`,
    )
    .bind(ip, cutoff)
    .first<{ cnt: number }>();
  return { allowed: !row || row.cnt < MAX_ATTEMPTS };
}

export async function recordResetAttempt(db: D1Database, ip: string): Promise<void> {
  const now = nowSql();
  await db
    .prepare(
      `INSERT INTO password_reset_rate_limits (ip_address, attempted_at) VALUES (?1, ?2)`,
    )
    .bind(ip, now)
    .run();
}
