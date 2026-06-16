# Alerting Rules [Master_Prompt v7.0 §6.3]

| Tier | Trigger | Channel | Response SLA |
|------|---------|---------|---------------|
| **Critical (page immediately)** | `payment_webhook_failures` failure rate > 5% over 5 min | PagerDuty → on-call | Acknowledge within 15 min |
| **Critical** | D1 unavailable (any `d1_query_duration_ms` p99 > 10s sustained) for > 2 min | PagerDuty | Acknowledge within 15 min |
| **Critical** | Security breach signal (auth-bypass attempt logged in audit_log with action `security.breach`) | PagerDuty + SMS to owner | Acknowledge within 15 min |
| **High (notify within 15 min)** | `checkout_attempts` failure rate > 20% for 15 min | Slack `#zabir-ops` | Notify within 15 min |
| **High** | `fraud_score_api_latency_ms` timeout rate > 10% for 10 min | Slack `#zabir-ops` | Notify within 15 min |
| **High** | Worker error rate > 5% for 5 min | Slack `#zabir-ops` | Notify within 15 min |
| **Medium (notify within 1 hour)** | `cache_hit_rate` below 50% for product pages | Slack `#zabir-eng` | Notify within 1 hour |
| **Medium** | `stock_reservation_failures` > 50 per cleanup run | Slack `#zabir-eng` | Notify within 1 hour |
| **Medium** | Revenue anomaly (zero revenue for 30 min during business hours) | Slack `#zabir-ops` | Notify within 1 hour |
| **Low (daily digest)** | `d1_query_duration_ms` slow query trends | Email digest | Daily at 09:00 UTC |
| **Low** | AI budget consumption (daily usage > 80% of cap) | Email digest | Daily at 09:00 UTC |

## Where the metrics come from

All metrics are written via `src/lib/analytics.ts` → `env.ANALYTICS.writeDataPoint()`
(Analytics Engine dataset `zabir_metrics`, bound in `wrangler.jsonc`).

For local dev or environments without the Analytics Engine binding, the helper
is a no-op (per the graceful-degradation contract in `src/lib/analytics.ts`).

## Configuring the alerting

Cloudflare Analytics Engine does not emit alerts directly. A small sidecar
or scheduled Worker should query the dataset every minute via the
GraphQL Analytics API and fan out alerts to the channels above.

Recommended implementation (not in this repo — for the platform team):

```ts
// alerts-worker (separate Worker, runs on cron "* * * * *")
import { AnalyticsEngineDataset } from "@cloudflare/workers-types";
export default {
  async scheduled(event, env, ctx) {
    const res = await fetch("https://api.cloudflare.com/client/v4/accounts/" + env.ACCOUNT_ID + "/analytics_engine/sql",
      { method: "POST", headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "text/plain" },
        body: `SELECT index1 AS metric, max(value) AS latest FROM zabir_metrics WHERE timestamp > NOW() - INTERVAL '5' MINUTE GROUP BY metric` });
    // For each metric, evaluate the tier table and send to the appropriate channel.
  }
}
```
