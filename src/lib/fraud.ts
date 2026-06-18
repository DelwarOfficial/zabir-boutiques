/**
 * FraudBD Risk Routing [Master_Prompt v7.0 §11.2]
 * FraudBD is an external risk signal only.
 * D1 stores the raw response and internal decision; FraudBD never becomes the order source of truth.
 *
 * Risk Routing (canonical thresholds):
 * 0-40:  approved — Auto-approve, allow COD and normal staff workflow.
 * 41-70: review   — Create order with pending_review; staff must confirm before fulfillment.
 * 71-100: blocked — Reject before reservation/order creation.
 * Timeout/error: review — Allow with pending_review flag; do not block automatically.
 */
import { nowSql } from './dates';
import { doCheckProviderHealth, doRecordProviderResult } from './do-client';

export type FraudDecision = 'approved' | 'review' | 'blocked';

export function decideFraudRisk(score: number | null): FraudDecision {
  if (score === null) return 'review';
  if (score <= 40) return 'approved';
  if (score <= 70) return 'review';
  return 'blocked';
}

/** Pathao rating-based risk_level → 0-100 risk score. Unknown/new => null (no signal). */
const PATHAO_RISK_SCORE: Record<string, number> = {
  low: 10,
  medium: 50,
  high: 85,
  very_high: 95
};

/**
 * Derive a 0-100 risk score from a FraudBD /check-courier-info response.
 * Higher score = higher risk. Returns null when there is no usable signal
 * (no delivery history and no rating) so the caller routes to manual review.
 *
 * Signals combined (most conservative wins):
 *  - Delivery couriers: totalSummary.cancelRate (when total > 0).
 *  - Pathao rating model: risk_level mapped via PATHAO_RISK_SCORE.
 */
export function deriveRiskScore(data: any): number | null {
  if (!data || data.status !== true || !data.data) return null;

  const scores: number[] = [];

  const totalSummary = data.data.totalSummary;
  if (totalSummary && Number(totalSummary.total) > 0) {
    const cancelRate = Number(totalSummary.cancelRate);
    if (Number.isFinite(cancelRate)) {
      scores.push(Math.max(0, Math.min(100, Math.round(cancelRate))));
    }
  }

  const pathao = data.data.Summaries?.Pathao;
  if (pathao && pathao.data_type === 'rating' && typeof pathao.risk_level === 'string') {
    const mapped = PATHAO_RISK_SCORE[pathao.risk_level];
    if (typeof mapped === 'number') scores.push(mapped);
  }

  if (scores.length === 0) return null;
  return Math.max(...scores);
}

/**
 * Call the FraudBD Check Courier Info API with a short timeout.
 * Uses ProviderHealthDO circuit breaker to short-circuit when provider is down.
 *
 * @param localPhone Bangladesh phone in local 01XXXXXXXXX format.
 * @param env Optional env for ProviderHealthDO circuit breaker access.
 */
export async function checkFraudBD(
  localPhone: string,
  apiKey: string,
  timeoutMs = 1500,
  baseUrl = 'https://fraudbd.com',
  env?: { PROVIDER_HEALTH_DO?: DurableObjectNamespace },
): Promise<{ score: number | null; rawResponse: string }> {
  // Circuit breaker check [Master_Prompt v7.0 §6.6]
  if (env?.PROVIDER_HEALTH_DO) {
    const health = await doCheckProviderHealth(env, 'fraudbd');
    if (!health.canProceed) {
      return { score: 50, rawResponse: '{"error":"circuit_open","fallback_score":50}' };
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/api/check-courier-info`, {
      method: 'POST',
      headers: {
        'api_key': apiKey,
        'accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ phone_number: localPhone }),
      signal: controller.signal
    });
    clearTimeout(timer);

    const data = await res.json().catch(() => null) as any;
    const rawResponse = JSON.stringify(data ?? { error: 'invalid_json' });
    if (!res.ok) {
      // Record failure
      if (env?.PROVIDER_HEALTH_DO) await doRecordProviderResult(env, 'fraudbd', false);
      return { score: null, rawResponse };
    }
    // Record success
    if (env?.PROVIDER_HEALTH_DO) await doRecordProviderResult(env, 'fraudbd', true);
    return { score: deriveRiskScore(data), rawResponse };
  } catch {
    clearTimeout(timer);
    // Record failure (timeout/network)
    if (env?.PROVIDER_HEALTH_DO) await doRecordProviderResult(env, 'fraudbd', false);
    return { score: null, rawResponse: '{"error":"timeout_or_network_error"}' };
  }
}

/**
 * Poll pending fraud checks. Called by every-10-minute cron.
 *
 * Current behavior (v6.8D):
 * - The synchronous checkFraudBD() call at checkout / staff order creation time is the
 *   authoritative source for the order's initial fraud_decision.
 * - This poller exists for future async "status" follow-ups from FraudBD (not yet implemented).
 * - Today it acts primarily as a sweeper + bounded bump for any legacy 'pending' rows
 *   in fraud_polls so they eventually time out instead of staying forever.
 * - No order fraud_decision is mutated here; staff can use fraud.override flows if needed.
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

    // No real async status endpoint implemented yet. Just advance the poll counter
    // so the row will be caught by sweepTimedOutFraudPolls on a future tick.
    // (Keeping the row allows future implementation to resume from poll_count.)
    await db.prepare(
      `UPDATE fraud_polls SET poll_count = poll_count + 1, next_poll_at = ?2, updated_at = ?3 WHERE id = ?1`
    ).bind(poll.id, nowSql(new Date(Date.now() + 10 * 60 * 1000)), now).run();
  }
}

/**
 * Mark timed-out fraud polls (poll_count >=5). Called by every-10-minute cron.
 * Complements pollPendingFraudChecks (which also marks some timeouts).
 */
export async function sweepTimedOutFraudPolls(db: D1Database): Promise<void> {
  const now = nowSql();
  await db.prepare(
    `UPDATE fraud_polls SET status = 'timeout', updated_at = ?1
     WHERE status = 'pending' AND poll_count >= 5`
  ).bind(now).run();
}
