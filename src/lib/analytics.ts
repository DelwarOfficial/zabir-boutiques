/**
 * Workers Analytics Engine [Master_Prompt v7.0 §6.2]
 *
 * Thin wrapper over `env.ANALYTICS.writeDataPoint`. If the binding is
 * missing (dev / preview), the call is a silent no-op.
 *
 * Schemas (9 metrics per §17.2 of the master plan):
 *  - orders_created            { revenue_paisa, payment_method, channel, fraud_score_bucket }
 *  - checkout_attempts         { result, payment_method }
 *  - payment_webhook_latency_ms { provider }
 *  - payment_webhook_failures  { provider, error_type }
 *  - stock_reservation_failures { variant_id }
 *  - d1_query_duration_ms      { query_type, route }
 *  - fraud_score_api_latency_ms { provider }
 *  - worker_cpu_time_ms        { route }
 *  - cache_hit_rate            { content_type }
 */
export interface MetricEvent {
  name: string;
  doubles?: Record<string, number>;
  indexes?: string[];
  blobs?: string[];
}

// safeLog is imported lazily inside the function to avoid pulling
// pii-scrubber into every module that tracks metrics.

export async function trackMetric(env: { ANALYTICS?: AnalyticsEngineDataset }, event: MetricEvent): Promise<void> {
  if (!env.ANALYTICS) return;
  try {
    const doubles: number[] = [];
    const blobs: string[] = [];
    const indexes: string[] = [event.name, ...(event.indexes ?? [])];
    if (event.doubles) {
      for (const [k, v] of Object.entries(event.doubles)) {
        doubles.push(v);
        blobs.push(k);
      }
    }
    if (event.blobs) {
      for (const b of event.blobs) blobs.push(b);
    }
    env.ANALYTICS.writeDataPoint({
      indexes,
      doubles,
      blobs,
    });
  } catch (err) {
    // Analytics is observability only; never break the request path.
    try {
      const { safeLog } = await import("./pii-scrubber");
      safeLog.warn("[analytics] writeDataPoint failed", { error: err instanceof Error ? err.message : String(err) });
    } catch {
      // If even safeLog is broken, fall back silently — analytics must
      // never break the request path.
    }
  }
}
