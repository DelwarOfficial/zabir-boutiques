globalThis.process ??= {};
globalThis.process.env ??= {};
import { n as nowSql } from "./sequence_XySMyPne.mjs";
function decideFraudRisk(score) {
  if (score === null) return "review";
  if (score <= 30) return "approved";
  if (score <= 79) return "review";
  return "blocked";
}
const PATHAO_RISK_SCORE = {
  low: 10,
  medium: 50,
  high: 85,
  very_high: 95
};
function deriveRiskScore(data) {
  if (!data || data.status !== true || !data.data) return null;
  const scores = [];
  const totalSummary = data.data.totalSummary;
  if (totalSummary && Number(totalSummary.total) > 0) {
    const cancelRate = Number(totalSummary.cancelRate);
    if (Number.isFinite(cancelRate)) {
      scores.push(Math.max(0, Math.min(100, Math.round(cancelRate))));
    }
  }
  const pathao = data.data.Summaries?.Pathao;
  if (pathao && pathao.data_type === "rating" && typeof pathao.risk_level === "string") {
    const mapped = PATHAO_RISK_SCORE[pathao.risk_level];
    if (typeof mapped === "number") scores.push(mapped);
  }
  if (scores.length === 0) return null;
  return Math.max(...scores);
}
async function checkFraudBD(localPhone, apiKey, timeoutMs = 3e3, baseUrl = "https://fraudbd.com") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/check-courier-info`, {
      method: "POST",
      headers: {
        "api_key": apiKey,
        "accept": "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ phone_number: localPhone }),
      signal: controller.signal
    });
    clearTimeout(timer);
    const data = await res.json().catch(() => null);
    const rawResponse = JSON.stringify(data ?? { error: "invalid_json" });
    if (!res.ok) return { score: null, rawResponse };
    return { score: deriveRiskScore(data), rawResponse };
  } catch {
    clearTimeout(timer);
    return { score: null, rawResponse: '{"error":"timeout_or_network_error"}' };
  }
}
async function pollPendingFraudChecks(db, _apiKey) {
  const now = nowSql();
  const pending = await db.prepare(
    `SELECT id, order_id, process_id, poll_count FROM fraud_polls
     WHERE status = 'pending' AND next_poll_at <= ?1
     LIMIT 10`
  ).bind(now).all();
  if (!pending.results || pending.results.length === 0) return;
  for (const poll of pending.results) {
    if (poll.poll_count >= 5) {
      await db.prepare(
        `UPDATE fraud_polls SET status = 'timeout', updated_at = ?2 WHERE id = ?1`
      ).bind(poll.id, now).run();
      continue;
    }
    await db.prepare(
      `UPDATE fraud_polls SET poll_count = poll_count + 1, next_poll_at = ?2, updated_at = ?3 WHERE id = ?1`
    ).bind(poll.id, nowSql(new Date(Date.now() + 10 * 60 * 1e3)), now).run();
  }
}
async function sweepTimedOutFraudPolls(db) {
  const now = nowSql();
  await db.prepare(
    `UPDATE fraud_polls SET status = 'timeout', updated_at = ?1
     WHERE status = 'pending' AND poll_count >= 5`
  ).bind(now).run();
}
export {
  checkFraudBD,
  decideFraudRisk,
  deriveRiskScore,
  pollPendingFraudChecks,
  sweepTimedOutFraudPolls
};
