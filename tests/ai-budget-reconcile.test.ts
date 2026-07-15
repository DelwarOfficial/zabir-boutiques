import { describe, it, expect, vi } from 'vitest';
import { BudgetCounterDO } from '../src/do/budget-counter-do';

function makeMockState() {
  const storage = new Map<string, unknown>();
  return {
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    storage: {
      get: vi.fn(async (k: string) => storage.get(k)),
      put: vi.fn(async (a: Record<string, unknown> | string, b?: unknown) => {
        if (typeof a === 'string') storage.set(a, b);
        else for (const [k, v] of Object.entries(a)) storage.set(k, v);
      }),
      setAlarm: vi.fn(async () => {}),
      delete: vi.fn(async (k: string) => storage.delete(k)),
    },
  } as unknown as DurableObjectState;
}

function newDo() {
  return new BudgetCounterDO(makeMockState(), {});
}

function post(action: string, body: Record<string, unknown>) {
  return new Request(`https://budget/${action}`, { method: 'POST', body: JSON.stringify(body) });
}

async function configure(do1: BudgetCounterDO, scope: string, limitUsdCents: number) {
  await do1.fetch(post('configure', { scope, limitUsdCents, periodSeconds: 86400, warnAtPercent: 0.8 }));
}

describe('DO-3: reconcile AI budget dual counters', () => {
  it('estimate hold + reconcile(actual-estimate) nets to exactly actual (no double charge)', async () => {
    const do1 = newDo();
    await configure(do1, 'ai:global:daily', 500);

    const estimate = 1;
    const actual = 3;

    await do1.fetch(post('increment', { costUsdCents: estimate, op: 'estimate' }));
    await do1.fetch(post('reconcile', { deltaUsdCents: actual - estimate, op: 'actual' }));

    const status = await (await do1.fetch(new Request('https://budget/status'))).json() as any;
    expect(status.totalUsdCents).toBe(actual);
  });

  it('documents the legacy bug: two raw increments net to estimate + actual', async () => {
    const do1 = newDo();
    await configure(do1, 'ai:global:daily', 500);

    await do1.fetch(post('increment', { costUsdCents: 1, op: 'estimate' }));
    await do1.fetch(post('increment', { costUsdCents: 3, op: 'actual' }));

    const status = await (await do1.fetch(new Request('https://budget/status'))).json() as any;
    // Legacy behavior over-charged by the estimate; reconciliation fixes this.
    expect(status.totalUsdCents).toBe(4);
  });

  it('reconcile with negative delta (actual < estimate) refunds and clamps at 0', async () => {
    const do1 = newDo();
    await configure(do1, 'ai:global:daily', 500);

    const estimate = 5;
    const actual = 2;

    await do1.fetch(post('increment', { costUsdCents: estimate, op: 'estimate' }));
    const res = await do1.fetch(post('reconcile', { deltaUsdCents: actual - estimate, op: 'actual' }));
    const data = await res.json() as any;
    expect(data.totalUsdCents).toBe(actual);
  });

  it('reconcile applies even when the call pushes past the limit (work already happened)', async () => {
    const do1 = newDo();
    await configure(do1, 'ai:global:daily', 10);

    const estimate = 8;
    const actual = 12;

    await do1.fetch(post('increment', { costUsdCents: estimate, op: 'estimate' }));
    const res = await do1.fetch(post('reconcile', { deltaUsdCents: actual - estimate, op: 'actual' }));
    const data = await res.json() as any;
    // Total reflects the real cost; allowed shows the over-limit state.
    expect(data.totalUsdCents).toBe(actual);
    expect(data.allowed).toBe(false);
  });

  it('ai-client.ts reconciles rather than double-charging actual cost', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/lib/ai-client.ts', 'utf8');
    // The post-call actual cost must go through reconcileBudget, never a
    // second chargeBudget that would double-count against the estimate hold.
    expect(src).toMatch(/reconcileBudget\(env, scope, out\.costUsdCents - estimatedCents/);
    expect(src).not.toMatch(/chargeBudget\(env, scope, out\.costUsdCents/);
  });
});
