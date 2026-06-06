/**
 * FraudBD Risk Routing [v6.8A]
 * FraudBD is an external risk signal only.
 * D1 stores the raw response and internal decision; FraudBD never becomes the order source of truth.
 *
 * Risk Routing:
 * 0-30:  approved — Allow COD and normal staff workflow.
 * 31-79: review   — Create order but require manager review before courier confirmation.
 * 80-100: blocked — Disable COD, request prepaid UddoktaPay or manager override.
 * Timeout/error: review — Do not block automatically; create manager review queue.
 */
import { nowSql } from './dates';

export type FraudDecision = 'approved' | 'review' | 'blocked';

export function decideFraudRisk(score: number | null): FraudDecision {
  if (score === null) return 'review';
  if (score <= 30) return 'approved';
  if (score <= 79) return 'review';
  return 'blocked';
}

/**
 * Call FraudBD API with a short timeout.
 * If timeout/error occurs, returns null score (which routes to 'review').
 */
export async function checkFraudBD(
  phone: string,
  apiKey: string,
  timeoutMs = 3000
): Promise<{ score: number | null; rawResponse: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch('https://fraudbd.com/api/check', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ phone }),
      signal: controller.signal
    });
    clearTimeout(timer);

    const data = await res.json() as any;
    const rawResponse = JSON.stringify(data);
    const score = typeof data.risk_score === 'number' ? data.risk_score : null;
    return { score, rawResponse };
  } catch {
    clearTimeout(timer);
    return { score: null, rawResponse: '{"error":"timeout_or_network_error"}' };
  }
}

/**
 * Poll pending fraud checks. Called by every-10-minute cron.
 */
export async function pollPendingFraudChecks(db: D1Database, _apiKey: string): Promise<void> {
  const now = nowSql();
  const pending = await db.prepare(
    `SELECT id, order_id, process_id, poll_count FROM fraud_polls
     WHERE status = 'pending' AND next_poll_at <= ?1
     LIMIT 10`
  ).bind(now).all<{ id: string; order_id: string; process_id: string; poll_count: number }>();

  if (!pending.results || pending.results.length === 0) return;

  for (const poll of pending.results) {
    if (poll.poll_count >= 5) {
      await db.prepare(
        `UPDATE fraud_polls SET status = 'timeout', updated_at = ?2 WHERE id = ?1`
      ).bind(poll.id, now).run();
      continue;
    }

    // Attempt to resolve via FraudBD status endpoint
    // Implementation depends on FraudBD async API contract
    await db.prepare(
      `UPDATE fraud_polls SET poll_count = poll_count + 1, next_poll_at = ?2, updated_at = ?3 WHERE id = ?1`
    ).bind(poll.id, nowSql(new Date(Date.now() + 10 * 60 * 1000)), now).run();
  }
}

/**
 * Mark timed-out fraud polls. Called by every-10-minute cron.
 */
export async function sweepTimedOutFraudPolls(db: D1Database): Promise<void> {
  const now = nowSql();
  await db.prepare(
    `UPDATE fraud_polls SET status = 'timeout', updated_at = ?1
     WHERE status = 'pending' AND poll_count >= 5`
  ).bind(now).run();
}
