/**
 * N-29: blind A/B comparison of AI providers (Master Plan §24.1).
 *
 * The point of the feature is that the evidence is trustworthy, so the tests
 * are mostly about what must NOT leak: provider identity before a pick, and
 * spend that escapes the §24.2 budget gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve('./db/migrations');

const generateProductContent = vi.fn();
const checkAiProviderAllowed = vi.fn();
const recordAiUsage = vi.fn();

vi.mock('../src/lib/env', () => ({ getEnv: (c: any) => c.locals.runtime.env }));
vi.mock('../src/lib/rbac', () => ({
  requireAuth: async () => ({ id: 'staff1', role: 'manager' }),
  requirePermission: () => {},
  RbacError: class extends Error {},
}));
vi.mock('../src/lib/audit', () => ({
  writeAuditLog: vi.fn(),
  clientIp: () => '127.0.0.1',
  userAgent: () => 'test',
}));
vi.mock('../src/lib/ai-content', async () => {
  const actual = await vi.importActual<any>('../src/lib/ai-content');
  return { ...actual, generateProductContent };
});
vi.mock('../src/lib/ai-provider-gate', () => ({ checkAiProviderAllowed, recordAiUsage }));

function content(tag: string) {
  return {
    description: `${tag} description copy long enough to clear the minimum length applied to generated product content.`,
    metaTitle: `${tag} title`,
    metaDescription: `${tag} meta`,
    metaTitleOverran: false,
    metaDescriptionOverran: false,
    provider: tag === 'DS' ? 'deepseek' : 'workers_ai',
    tokens_used: 100,
    cost_usd: 0.0005,
  };
}

function buildDb() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(resolve(MIGRATIONS, '0067_ai_generation_trials.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(MIGRATIONS, '0068_ai_generation_trials_index.sql'), 'utf8'));
  const db = {
    prepare: (sql: string) => {
      let bound: unknown[] = [];
      const api = {
        bind: (...v: unknown[]) => { bound = v; return api; },
        first: async () => (raw.prepare(sql) as any).all(...bound)[0] ?? null,
        all: async () => ({ results: (raw.prepare(sql) as any).all(...bound) }),
        run: async () => ({ meta: { changes: Number((raw.prepare(sql) as any).run(...bound).changes ?? 0) } }),
      };
      return api;
    },
  } as unknown as D1Database;
  return { raw, db };
}

function ctx(db: D1Database, body: unknown) {
  const request = new Request('https://x/api/staff/ai/compare-product-content', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return { request, locals: { runtime: { env: { DB: db } } } } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  checkAiProviderAllowed.mockResolvedValue({ allowed: true });
  generateProductContent.mockImplementation(async (_i: unknown, _e: unknown, provider: string) =>
    content(provider === 'deepseek' ? 'DS' : 'WA'),
  );
});

describe('blind comparison', () => {
  it('never reveals which provider produced which slot', async () => {
    const { db } = buildDb();
    const { POST } = await import('../src/pages/api/staff/ai/compare-product-content');
    const res = await POST(ctx(db, { name: 'Kurti' }));
    const payload = await res.json();

    expect(payload.ok).toBe(true);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('deepseek');
    expect(serialized).not.toContain('workers_ai');
    expect(payload.a.content.description).toBeTruthy();
    expect(payload.b.content.description).toBeTruthy();
  });

  it('runs both providers and meters both', async () => {
    const { db } = buildDb();
    const { POST } = await import('../src/pages/api/staff/ai/compare-product-content');
    await POST(ctx(db, { name: 'Kurti' }));

    const providers = generateProductContent.mock.calls.map((c) => c[2]).sort();
    expect(providers).toEqual(['deepseek', 'workers_ai']);
    expect(recordAiUsage).toHaveBeenCalledTimes(2);
    expect(checkAiProviderAllowed).toHaveBeenCalledTimes(2);
  });

  it('refuses the comparison when either budget is exhausted, before spending', async () => {
    checkAiProviderAllowed.mockResolvedValueOnce({ allowed: false, code: 'AI_BUDGET_REACHED' });
    const { db } = buildDb();
    const { POST } = await import('../src/pages/api/staff/ai/compare-product-content');
    const res = await POST(ctx(db, { name: 'Kurti' }));

    expect(res.status).toBe(429);
    expect(generateProductContent).not.toHaveBeenCalled();
    expect(recordAiUsage).not.toHaveBeenCalled();
  });

  it('persists the slot mapping server-side', async () => {
    const { raw, db } = buildDb();
    const { POST } = await import('../src/pages/api/staff/ai/compare-product-content');
    await POST(ctx(db, { name: 'Kurti' }));

    const row = raw.prepare('SELECT slot_a_provider, slot_b_provider, chosen_provider FROM ai_generation_trials').get() as any;
    expect([row.slot_a_provider, row.slot_b_provider].sort()).toEqual(['deepseek', 'workers_ai']);
    expect(row.chosen_provider).toBe(null);
  });

  it('randomizes which provider gets slot A across trials', async () => {
    const { raw, db } = buildDb();
    const { POST } = await import('../src/pages/api/staff/ai/compare-product-content');
    for (let i = 0; i < 40; i++) await POST(ctx(db, { name: `Kurti ${i}` }));

    const rows = raw.prepare('SELECT slot_a_provider FROM ai_generation_trials').all() as any[];
    const deepseekFirst = rows.filter((r) => r.slot_a_provider === 'deepseek').length;
    // Not a distribution test — just proof the assignment is not a constant,
    // which is the failure mode that would silently bias every trial.
    expect(deepseekFirst).toBeGreaterThan(0);
    expect(deepseekFirst).toBeLessThan(40);
  });

  it('requires a product name', async () => {
    const { db } = buildDb();
    const { POST } = await import('../src/pages/api/staff/ai/compare-product-content');
    expect((await POST(ctx(db, { name: '  ' }))).status).toBe(400);
  });
});

describe('recording a pick', () => {
  async function seedTrial(db: D1Database, raw: DatabaseSync) {
    const { POST } = await import('../src/pages/api/staff/ai/compare-product-content');
    await POST(ctx(db, { name: 'Kurti' }));
    return raw.prepare('SELECT id, slot_a_provider, slot_b_provider FROM ai_generation_trials').get() as any;
  }

  function choiceCtx(db: D1Database, body: unknown) {
    return {
      request: new Request('https://x/api/staff/ai/trial-choice', { method: 'POST', body: JSON.stringify(body) }),
      locals: { runtime: { env: { DB: db } } },
    } as any;
  }

  it('resolves the picked slot to the provider behind it and reveals both', async () => {
    const { raw, db } = buildDb();
    const trial = await seedTrial(db, raw);
    const { POST } = await import('../src/pages/api/staff/ai/trial-choice');

    const res = await POST(choiceCtx(db, { trial_id: trial.id, choice: 'a' }));
    const payload = await res.json();

    expect(payload.chosen_provider).toBe(trial.slot_a_provider);
    expect(payload.slot_a_provider).toBe(trial.slot_a_provider);
    expect(payload.slot_b_provider).toBe(trial.slot_b_provider);
    expect(payload.tally[trial.slot_a_provider]).toBe(1);
  });

  it('records "neither" as a real answer', async () => {
    const { raw, db } = buildDb();
    const trial = await seedTrial(db, raw);
    const { POST } = await import('../src/pages/api/staff/ai/trial-choice');
    const payload = await (await POST(choiceCtx(db, { trial_id: trial.id, choice: 'neither' }))).json();
    expect(payload.chosen_provider).toBe('neither');
  });

  it('is single-shot — a pick cannot be changed after the reveal', async () => {
    const { raw, db } = buildDb();
    const trial = await seedTrial(db, raw);
    const { POST } = await import('../src/pages/api/staff/ai/trial-choice');

    await POST(choiceCtx(db, { trial_id: trial.id, choice: 'a' }));
    const second = await (await POST(choiceCtx(db, { trial_id: trial.id, choice: 'b' }))).json();

    expect(second.already_recorded).toBe(true);
    expect(second.chosen_provider).toBe(trial.slot_a_provider);
    const row = raw.prepare('SELECT chosen_provider FROM ai_generation_trials WHERE id = ?').get(trial.id) as any;
    expect(row.chosen_provider).toBe(trial.slot_a_provider);
  });

  it('rejects an unknown trial and a malformed choice', async () => {
    const { raw, db } = buildDb();
    const trial = await seedTrial(db, raw);
    const { POST } = await import('../src/pages/api/staff/ai/trial-choice');
    expect((await POST(choiceCtx(db, { trial_id: 'nope', choice: 'a' }))).status).toBe(404);
    expect((await POST(choiceCtx(db, { trial_id: trial.id, choice: 'c' }))).status).toBe(400);
    expect((await POST(choiceCtx(db, { choice: 'a' }))).status).toBe(400);
  });
});

describe('cost is not a tell', () => {
  it('withholds per-slot cost, which would identify the provider as surely as its name', async () => {
    const { raw, db } = buildDb();
    const { POST } = await import('../src/pages/api/staff/ai/compare-product-content');
    const payload = await (await POST(ctx(db, { name: 'Kurti' }))).json();

    // A slot priced at $0 is unmistakably Workers AI.
    expect(payload.a.metrics.costUsd).toBeUndefined();
    expect(payload.b.metrics.costUsd).toBeUndefined();
    // Still recorded server-side for the rollup.
    const row = raw.prepare('SELECT metrics_json FROM ai_generation_trials').get() as any;
    expect(JSON.parse(row.metrics_json).a).toHaveProperty('costUsd');
  });
});
