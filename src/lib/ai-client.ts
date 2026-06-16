/**
 * AI Client [Master_Prompt v7.0 §13.5, Phase 6.5]
 *
 * Workers AI is the primary inference provider. DeepSeek is the
 * fallback for cases when Workers AI is rate-limited, errors
 * (timeout, content blocked), or simply returns lower-quality
 * results. The fallback only kicks in for non-safety-critical
 * tasks (e.g. product description generation, copy suggestions).
 * For moderation we always trust Workers AI.
 *
 * Costs are charged to the BudgetCounterDO per scope:
 *   - "ai:global:daily" — platform-wide daily cap.
 *   - "ai:user:<id>:daily" — per-user daily cap.
 *   - "ai:ip:<ip>:hourly" — per-IP hourly cap.
 *
 * If a budget returns allowed=false, the call is rejected and
 * the caller is told.
 */
import { chargeBudget, configureScope } from "../do/budget-counter-do";
import { moderate } from "./content-moderation";

interface Env {
  AI: Ai;
  AI_FALLBACK_URL?: string;
  AI_FALLBACK_KEY?: string;
  AI_BUDGET: DurableObjectNamespace;
  ANALYTICS?: AnalyticsEngineDataset;
}

export type AiTask = "describe_product" | "summarize_review" | "translate" | "copy_suggestion";

export interface AiCallResult {
  text: string;
  provider: "workers-ai" | "deepseek" | "rejected";
  costUsdCents: number;
  moderation?: "allow" | "quarantine" | "block";
}

const TASK_MODEL: Record<AiTask, string> = {
  describe_product: "@cf/meta/llama-3.1-8b-instruct",
  summarize_review: "@cf/meta/llama-3.1-8b-instruct",
  translate: "@cf/meta/m2m100-1.2b",
  copy_suggestion: "@cf/meta/llama-3.1-8b-instruct",
};

const COST_PER_1K_TOKENS_CENTS = 2; // approx; tunable

function estimateCostCents(tokens: number): number {
  return Math.max(1, Math.round((tokens / 1000) * COST_PER_1K_TOKENS_CENTS));
}

export async function ensureBudgets(env: Env): Promise<void> {
  // Idempotent — DO storage overwrites; daily: 500 cents = $5.
  await configureScope(env, "ai:global:daily", 500);
  await configureScope(env, "ai:user:anon:daily", 50);
  await configureScope(env, "ai:ip:anon:hourly", 25);
}

export async function aiCall(env: Env, task: AiTask, prompt: string, scope = "ai:global:daily"): Promise<AiCallResult> {
  // 1) Input moderation.
  const m = await moderate({ AI: env.AI }, { text: prompt, field: `ai.${task}.input` });
  if (m.decision === "block") {
    return { text: "", provider: "rejected", costUsdCents: 0, moderation: m.decision };
  }

  // 2) Budget check.
  const budget = await chargeBudget(env, scope, estimateCostCents(256), `estimate:${task}`);
  if (!budget.allowed) {
    return { text: "", provider: "rejected", costUsdCents: 0, moderation: "block" };
  }

  // 3) Primary: Workers AI.
  try {
    const out = await runWorkersAi(env, task, prompt);
    await chargeBudget(env, scope, out.costUsdCents, `actual:${task}:workers-ai`);
    return out;
  } catch (err) {
    console.warn(`[ai] workers-ai failed (${task}):`, err);
  }

  // 4) Fallback: DeepSeek.
  if (env.AI_FALLBACK_URL && env.AI_FALLBACK_KEY) {
    try {
      const out = await runDeepSeek(env, task, prompt);
      await chargeBudget(env, scope, out.costUsdCents, `actual:${task}:deepseek`);
      return out;
    } catch (err) {
      console.error(`[ai] deepseek fallback failed (${task}):`, err);
    }
  }

  return { text: "", provider: "rejected", costUsdCents: 0, moderation: "block" };
}

async function runWorkersAi(env: Env, task: AiTask, prompt: string): Promise<AiCallResult> {
  const model = TASK_MODEL[task];
  const resp = (await env.AI.run(model as never, {
    messages: [
      { role: "system", content: "You write concise, brand-appropriate copy for a Bangladeshi boutique. Stay under 80 words." },
      { role: "user", content: prompt },
    ],
  })) as { response?: string } | undefined;
  const text = resp?.response ?? "";
  if (!text) throw new Error("workers-ai empty response");
  const cost = estimateCostCents(text.split(/\s+/).length);
  if (env.ANALYTICS) {
    env.ANALYTICS.writeDataPoint({ indexes: [task, "workers-ai"], doubles: [cost] });
  }
  return { text, provider: "workers-ai", costUsdCents: cost };
}

async function runDeepSeek(env: Env, task: AiTask, prompt: string): Promise<AiCallResult> {
  const url = env.AI_FALLBACK_URL!;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.AI_FALLBACK_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: "You write concise, brand-appropriate copy for a Bangladeshi boutique. Stay under 80 words." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!r.ok) throw new Error(`deepseek http ${r.status}`);
  const data = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("deepseek empty response");
  const cost = estimateCostCents(text.split(/\s+/).length);
  if (env.ANALYTICS) {
    env.ANALYTICS.writeDataPoint({ indexes: [task, "deepseek"], doubles: [cost] });
  }
  return { text, provider: "deepseek", costUsdCents: cost };
}
