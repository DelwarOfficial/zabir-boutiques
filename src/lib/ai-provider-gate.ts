/**
 * Shared budget/cap gate for staff AI generation (N-29).
 *
 * Both the normal generate path and the A/B compare path must apply the exact
 * same §24.2 rules; duplicating them is how the two drift and the compare path
 * quietly becomes an unmetered way to spend money.
 */
import {
  canUseDeepSeekBudget,
  canUseWorkersAIBudget,
  recordDeepSeekUsage,
  recordWorkersAIUsage,
} from '../do/budget-counter-do';
import { claimAiFallbackSlot, type FallbackCapEnv } from './ai-fallback-cap';

export type AiProvider = 'deepseek' | 'workers_ai';

export type GateResult =
  | { allowed: true }
  | { allowed: false; code: 'AI_BUDGET_REACHED' | 'AI_FALLBACK_CAP_REACHED' };

/**
 * Decide whether `provider` may be called right now.
 *
 * `viaFallback` marks a Workers AI call that was NOT explicitly asked for —
 * i.e. one we reached because DeepSeek was unavailable. Those are the calls
 * §24.2 caps hourly, because they are the ones that spike during an outage.
 */
export async function checkAiProviderAllowed(
  env: FallbackCapEnv & Parameters<typeof canUseDeepSeekBudget>[0],
  provider: AiProvider,
  viaFallback: boolean,
): Promise<GateResult> {
  let withinBudget = true;
  try {
    withinBudget = provider === 'deepseek'
      ? await canUseDeepSeekBudget(env)
      : await canUseWorkersAIBudget(env);
  } catch {
    // §24.2: a budget-check failure must never block the staff action.
    withinBudget = true;
  }
  if (!withinBudget) return { allowed: false, code: 'AI_BUDGET_REACHED' };

  if (viaFallback) {
    const slot = await claimAiFallbackSlot(env);
    if (!slot.allowed) return { allowed: false, code: 'AI_FALLBACK_CAP_REACHED' };
  }
  return { allowed: true };
}

/** Record spend against whichever provider actually ran. */
export async function recordAiUsage(
  env: Parameters<typeof recordDeepSeekUsage>[0],
  provider: AiProvider,
  usage: { tokens: number; cost_usd: number; request_id: string; staff_id: string; operation: string },
): Promise<void> {
  if (provider === 'deepseek') await recordDeepSeekUsage(env, usage);
  else await recordWorkersAIUsage(env, usage);
}
