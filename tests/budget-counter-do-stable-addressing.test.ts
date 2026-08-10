import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canUseDeepSeekBudget, canUseWorkersAIBudget, canUseImagifyBudget, recordDeepSeekUsage } from '../src/do/budget-counter-do';

/**
 * N-2 Case B: BudgetCounterDO's provider-specific functions must address a
 * single, stable `budget:{provider}` object forever — never a date-suffixed
 * key. The old `${provider}:${date}` addressing silently discarded the
 * monthly bucket every UTC day (C-04/C-05: "budgets never enforced"), even
 * though recordUsage/canUseProvider already tracked daily+monthly buckets
 * correctly inside whatever object happened to be addressed.
 */
function fakeNamespace() {
  const idFromName = vi.fn((name: string) => name);
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ allowed: true })));
  const get = vi.fn((_name: string) => ({ fetch: fetchImpl }));
  return { idFromName, get, fetchImpl } as unknown as DurableObjectNamespace & { idFromName: any; get: any; fetchImpl: any };
}

describe('N-2 Case B: BudgetCounterDO addresses budget:{provider}, never {provider}:{date}', () => {
  it('canUseDeepSeekBudget', async () => {
    const ns = fakeNamespace();
    await canUseDeepSeekBudget({ AI_BUDGET: ns } as never);
    expect((ns as any).idFromName).toHaveBeenCalledWith('budget:deepseek');
  });

  it('canUseWorkersAIBudget', async () => {
    const ns = fakeNamespace();
    await canUseWorkersAIBudget({ AI_BUDGET: ns } as never);
    expect((ns as any).idFromName).toHaveBeenCalledWith('budget:workers_ai');
  });

  it('canUseImagifyBudget', async () => {
    const ns = fakeNamespace();
    await canUseImagifyBudget({ AI_BUDGET: ns } as never);
    expect((ns as any).idFromName).toHaveBeenCalledWith('budget:imagify');
  });

  it('recordDeepSeekUsage', async () => {
    const ns = fakeNamespace();
    await recordDeepSeekUsage({ AI_BUDGET: ns } as never, {
      tokens: 100,
      cost_usd: 0.01,
      request_id: 'r1',
      staff_id: 's1',
      operation: 'chat',
    });
    expect((ns as any).idFromName).toHaveBeenCalledWith('budget:deepseek');
  });

  it('the same provider resolves to the same object regardless of what day it is called (no date embedded in the key)', async () => {
    const realDateNow = Date.now;
    const ns = fakeNamespace();
    try {
      Date.now = () => new Date('2026-01-01T00:00:00Z').getTime();
      await canUseDeepSeekBudget({ AI_BUDGET: ns } as never);
      Date.now = () => new Date('2026-02-15T00:00:00Z').getTime();
      await canUseDeepSeekBudget({ AI_BUDGET: ns } as never);
    } finally {
      Date.now = realDateNow;
    }
    const calls = (ns as any).idFromName.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).toEqual(['budget:deepseek', 'budget:deepseek']);
  });

  it('DO source: pruning alarm exists and covers daily/monthly/usage-dedup keys, since budget:{provider} objects now live forever', () => {
    const src = readFileSync(resolve('./src/do/budget-counter-do.ts'), 'utf8');
    expect(src).toContain('async alarm(): Promise<void>');
    expect(src).toContain('pruneStaleUsageKeys');
    expect(src).toContain('ensurePruneAlarmScheduled');
    expect(src).toContain('prefix: "daily:"');
    expect(src).toContain('prefix: "monthly:"');
    expect(src).toContain('prefix: "usage:"');
    expect(src).toContain('recordedAtMs');
  });

  it('DO source: recordUsage stamps recordedAtMs so the dedup key can be pruned by age', () => {
    const src = readFileSync(resolve('./src/do/budget-counter-do.ts'), 'utf8');
    const recordUsage = src.slice(src.indexOf('async recordUsage'), src.indexOf('private async canUseProvider'));
    expect(recordUsage).toContain('recordedAtMs: Date.now()');
  });

  it('generic scope-based budget functions (configureScope/chargeBudget/reconcileBudget) are unaffected — no date embedded in their addressing to begin with', () => {
    const src = readFileSync(resolve('./src/do/budget-counter-do.ts'), 'utf8');
    expect(src).toContain('env.AI_BUDGET.idFromName(scope)');
  });
});
