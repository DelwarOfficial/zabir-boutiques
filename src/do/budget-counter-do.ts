/**
 * Budget Counter Durable Object [Master_Prompt v7.0 §13.3, Phase 6.3]
 *
 * Per-actor, per-period budget enforcement for AI calls. One DO
 * instance per scope (e.g. "user:<id>:<period>", "ip:<ip>:<period>").
 * The DO uses a single-writer per scope, so the count is exact.
 *
 * On every increment, the DO checks the configured limit. If the
 * new total exceeds the limit, the call is rejected. Limits are
 * stored in the DO so admins can hot-reload them via the
 * staff/dev/api-keys page (or a future admin route).
 */
interface Env {
  AI_BUDGET: DurableObjectNamespace;
  ANALYTICS?: AnalyticsEngineDataset;
}

interface BudgetConfig {
  scope: string;            // e.g. "user:abc123:daily"
  periodSeconds: number;    // 86400 for daily, 3600 for hourly
  limitUsdCents: number;    // in cents (USD) for the period
  warnAtPercent: number;    // 0..1
  metadata?: Record<string, string>;
}

interface IncrementRequest {
  costUsdCents: number;
  op: string; // e.g. "workers-ai:llama", "deepseek:chat"
}

interface IncrementResult {
  allowed: boolean;
  totalUsdCents: number;
  limitUsdCents: number;
  remainingUsdCents: number;
  warn: boolean;
  resetAt: string;
}

export class BudgetCounterDO implements DurableObject {
  private storage: DurableObjectStorage;
  private env: Env;
  private cfg: BudgetConfig | null = null;
  private totalUsdCents = 0;
  private periodStartMs = 0;

  constructor(state: DurableObjectState, env: Env) {
    this.storage = state.storage;
    this.env = env;
    void state.blockConcurrencyWhile(async () => {
      this.cfg = (await state.storage.get<BudgetConfig>("cfg")) ?? null;
      this.totalUsdCents = (await state.storage.get<number>("total")) ?? 0;
      this.periodStartMs = (await state.storage.get<number>("periodStartMs")) ?? 0;
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/configure") {
      this.cfg = (await req.json()) as BudgetConfig;
      // Reset counters when the config is set.
      this.totalUsdCents = 0;
      this.periodStartMs = Date.now();
      await this.storage.put("cfg", this.cfg);
      await this.storage.put("total", this.totalUsdCents);
      await this.storage.put("periodStartMs", this.periodStartMs);
      return Response.json({ ok: true });
    }
    if (req.method === "GET" && url.pathname === "/status") {
      return Response.json(this.status());
    }
    if (req.method === "POST" && url.pathname === "/increment") {
      const body = (await req.json()) as IncrementRequest;
      return Response.json(await this.increment(body));
    }
    return new Response("not found", { status: 404 });
  }

  private status(): IncrementResult & { scope: string | null; op: string | null } {
    if (!this.cfg) {
      return { allowed: true, totalUsdCents: 0, limitUsdCents: 0, remainingUsdCents: 0, warn: false, resetAt: "", scope: null, op: null };
    }
    this.maybeRollover();
    return {
      allowed: this.totalUsdCents < this.cfg.limitUsdCents,
      totalUsdCents: this.totalUsdCents,
      limitUsdCents: this.cfg.limitUsdCents,
      remainingUsdCents: Math.max(0, this.cfg.limitUsdCents - this.totalUsdCents),
      warn: this.totalUsdCents >= this.cfg.limitUsdCents * this.cfg.warnAtPercent,
      resetAt: new Date(this.periodStartMs + this.cfg.periodSeconds * 1000).toISOString(),
      scope: this.cfg.scope,
      op: null,
    };
  }

  private maybeRollover() {
    if (!this.cfg) return;
    if (Date.now() - this.periodStartMs >= this.cfg.periodSeconds * 1000) {
      this.periodStartMs = Date.now();
      this.totalUsdCents = 0;
      void this.storage.put("periodStartMs", this.periodStartMs);
      void this.storage.put("total", 0);
    }
  }

  private async increment(body: IncrementRequest): Promise<IncrementResult> {
    if (!this.cfg) {
      return { allowed: true, totalUsdCents: 0, limitUsdCents: 0, remainingUsdCents: 0, warn: false, resetAt: "" };
    }
    this.maybeRollover();
    const projected = this.totalUsdCents + body.costUsdCents;
    const allowed = projected <= this.cfg.limitUsdCents;
    if (allowed) {
      this.totalUsdCents = projected;
      await this.storage.put("total", this.totalUsdCents);
      if (this.env.ANALYTICS) {
        this.env.ANALYTICS.writeDataPoint({
          indexes: [this.cfg.scope, body.op],
          doubles: [body.costUsdCents, this.totalUsdCents],
        });
      }
    }
    return {
      allowed,
      totalUsdCents: this.totalUsdCents,
      limitUsdCents: this.cfg.limitUsdCents,
      remainingUsdCents: Math.max(0, this.cfg.limitUsdCents - this.totalUsdCents),
      warn: this.totalUsdCents >= this.cfg.limitUsdCents * this.cfg.warnAtPercent,
      resetAt: new Date(this.periodStartMs + this.cfg.periodSeconds * 1000).toISOString(),
    };
  }
}

/** Helpers for callers. */
export async function configureScope(env: Env, scope: string, limitUsdCents: number, periodSeconds = 86400, warnAtPercent = 0.8): Promise<void> {
  const id = env.AI_BUDGET.idFromName(scope);
  const stub = env.AI_BUDGET.get(id);
  await stub.fetch("https://budget/configure", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope, limitUsdCents, periodSeconds, warnAtPercent }),
  });
}

export async function chargeBudget(env: Env, scope: string, costUsdCents: number, op: string): Promise<IncrementResult> {
  const id = env.AI_BUDGET.idFromName(scope);
  const stub = env.AI_BUDGET.get(id);
  return (await stub.fetch("https://budget/increment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ costUsdCents, op }),
  }).then(r => r.json())) as IncrementResult;
}
