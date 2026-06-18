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
  DB?: D1Database;
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

type BudgetProvider = 'workers_ai' | 'deepseek' | 'imagify';

const DEFAULT_LIMITS: Record<BudgetProvider, { dailyUsdCents: number; monthlyUsdCents: number; dailyCalls: number; monthlyCalls: number }> = {
  workers_ai: { dailyUsdCents: 100, monthlyUsdCents: 2000, dailyCalls: 200, monthlyCalls: 5000 },
  deepseek: { dailyUsdCents: 500, monthlyUsdCents: 10000, dailyCalls: 50, monthlyCalls: 1000 },
  imagify: { dailyUsdCents: 100, monthlyUsdCents: 2000, dailyCalls: 100, monthlyCalls: 3000 },
};

type ProviderLimits = { dailyUsdCents: number; monthlyUsdCents: number; dailyCalls: number; monthlyCalls: number; ownerOverride: boolean };

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
    if (req.method === "GET" && url.pathname === "/can-use-deepseek") {
      return Response.json({ allowed: await this.canUseDeepSeek() });
    }
    if (req.method === "POST" && url.pathname === "/record-usage") {
      return Response.json(await this.recordUsage(await req.json() as Parameters<BudgetCounterDO['recordUsage']>[0]));
    }
    return new Response("not found", { status: 404 });
  }

  async canUseDeepSeek(): Promise<boolean> {
    return this.canUseProvider('deepseek');
  }

  async canUseWorkersAI(): Promise<boolean> {
    return this.canUseProvider('workers_ai');
  }

  async canUseImagify(): Promise<boolean> {
    return this.canUseProvider('imagify');
  }

  async recordUsage(input: {
    provider: BudgetProvider;
    tokens: number;
    cost_usd: number;
    request_id: string;
    staff_id: string;
    operation: string;
  }): Promise<{ recorded: boolean; new_daily_total_usd: number; new_monthly_total_usd: number; soft_alert_triggered: boolean; hard_block_reached: boolean }> {
    const key = `usage:${input.provider}:${input.request_id}`;
    const existing = await this.storage.get<{ dailyUsd: number; monthlyUsd: number }>(key);
    if (existing) {
      return {
        recorded: false,
        new_daily_total_usd: existing.dailyUsd,
        new_monthly_total_usd: existing.monthlyUsd,
        soft_alert_triggered: false,
        hard_block_reached: false,
      };
    }

    const costUsdCents = Math.ceil(input.cost_usd * 100);
    const dailyKey = `daily:${input.provider}:${new Date().toISOString().slice(0, 10)}`;
    const monthlyKey = `monthly:${input.provider}:${new Date().toISOString().slice(0, 7)}`;
    const daily = (await this.storage.get<{ calls: number; cents: number }>(dailyKey)) ?? { calls: 0, cents: 0 };
    const monthly = (await this.storage.get<{ calls: number; cents: number }>(monthlyKey)) ?? { calls: 0, cents: 0 };
    daily.calls += 1;
    daily.cents += costUsdCents;
    monthly.calls += 1;
    monthly.cents += costUsdCents;
    await this.storage.put({ [dailyKey]: daily, [monthlyKey]: monthly, [key]: { dailyUsd: daily.cents / 100, monthlyUsd: monthly.cents / 100 } });

    const limits = await this.getProviderLimits(input.provider);
    const dailyPercent = Math.max((daily.cents / limits.dailyUsdCents) * 100, (daily.calls / limits.dailyCalls) * 100);
    const monthlyPercent = Math.max((monthly.cents / limits.monthlyUsdCents) * 100, (monthly.calls / limits.monthlyCalls) * 100);
    const maxPercent = Math.max(dailyPercent, monthlyPercent);
    return {
      recorded: true,
      new_daily_total_usd: daily.cents / 100,
      new_monthly_total_usd: monthly.cents / 100,
      soft_alert_triggered: maxPercent >= 80,
      hard_block_reached: maxPercent >= 100,
    };
  }

  private async canUseProvider(provider: BudgetProvider): Promise<boolean> {
    const limits = await this.getProviderLimits(provider);
    if (limits.ownerOverride) return true;
    const dailyKey = `daily:${provider}:${new Date().toISOString().slice(0, 10)}`;
    const monthlyKey = `monthly:${provider}:${new Date().toISOString().slice(0, 7)}`;
    const daily = (await this.storage.get<{ calls: number; cents: number }>(dailyKey)) ?? { calls: 0, cents: 0 };
    const monthly = (await this.storage.get<{ calls: number; cents: number }>(monthlyKey)) ?? { calls: 0, cents: 0 };
    return daily.calls < limits.dailyCalls
      && monthly.calls < limits.monthlyCalls
      && daily.cents < limits.dailyUsdCents
      && monthly.cents < limits.monthlyUsdCents;
  }

  private async getProviderLimits(provider: BudgetProvider): Promise<ProviderLimits> {
    const cacheKey = `limits:${provider}`;
    const cached = await this.storage.get<ProviderLimits>(cacheKey);
    if (cached) return cached;
    const fallback = DEFAULT_LIMITS[provider];
    if (!this.env.DB) return { ...fallback, ownerOverride: false };
    try {
      const row = await this.env.DB.prepare(
        `SELECT daily_limit_usd_cents, monthly_limit_usd_cents, daily_call_limit,
                monthly_call_limit, owner_override
         FROM ai_budget_limits WHERE provider = ?1`,
      ).bind(provider).first<{
        daily_limit_usd_cents: number;
        monthly_limit_usd_cents: number;
        daily_call_limit: number;
        monthly_call_limit: number;
        owner_override: number;
      }>();
      const limits: ProviderLimits = row
        ? {
            dailyUsdCents: row.daily_limit_usd_cents,
            monthlyUsdCents: row.monthly_limit_usd_cents,
            dailyCalls: row.daily_call_limit,
            monthlyCalls: row.monthly_call_limit,
            ownerOverride: row.owner_override === 1,
          }
        : { ...fallback, ownerOverride: false };
      await this.storage.put(cacheKey, limits);
      return limits;
    } catch {
      return { ...fallback, ownerOverride: false };
    }
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

export async function canUseDeepSeekBudget(env: Env): Promise<boolean> {
  const id = env.AI_BUDGET.idFromName(`deepseek:${new Date().toISOString().slice(0, 10)}`);
  const stub = env.AI_BUDGET.get(id);
  const res = await stub.fetch("https://budget/can-use-deepseek");
  const data = await res.json() as { allowed?: boolean };
  return data.allowed === true;
}

export async function recordDeepSeekUsage(env: Env, input: { tokens: number; cost_usd: number; request_id: string; staff_id: string; operation: string }): Promise<void> {
  const id = env.AI_BUDGET.idFromName(`deepseek:${new Date().toISOString().slice(0, 10)}`);
  const stub = env.AI_BUDGET.get(id);
  await stub.fetch("https://budget/record-usage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: 'deepseek', ...input }),
  });
}
