/**
 * N-29: which AI provider runs, and when (Master Plan §24.1).
 *
 * Workers AI is primary for product descriptions; DeepSeek is secondary. This
 * default has been reversed twice, so it is pinned here rather than left to a
 * comment — a future edit that flips it should have to flip a test too, and
 * say so.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateProductContent = vi.fn();
const canUseWorkersAIBudget = vi.fn();
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
vi.mock('../src/do/budget-counter-do', () => ({ canUseWorkersAIBudget }));
vi.mock('../src/lib/ai-provider-gate', () => ({ checkAiProviderAllowed, recordAiUsage }));

function ctx(body: unknown) {
  return {
    request: new Request('https://x/api/staff/ai/generate-product-content', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    locals: { runtime: { env: { DB: {} } } },
  } as any;
}

/** The provider the route actually asked generateProductContent to use. */
function requestedProvider(): string {
  return generateProductContent.mock.calls[0][2];
}

/** Whether the gate was told this was a fallback detour (and so hourly-capped). */
function gateSawFallback(): boolean {
  return checkAiProviderAllowed.mock.calls[0][2];
}

beforeEach(() => {
  vi.clearAllMocks();
  canUseWorkersAIBudget.mockResolvedValue(true);
  checkAiProviderAllowed.mockResolvedValue({ allowed: true });
  generateProductContent.mockImplementation(async (_i: unknown, _e: unknown, provider: string) => ({
    description: 'Generated description copy long enough to clear the minimum length check applied to product content.',
    metaTitle: 'Title',
    metaDescription: 'Meta',
    provider,
    tokens_used: 100,
    cost_usd: 0.0001,
  }));
});

describe('provider precedence (§24.1)', () => {
  it('uses Workers AI by default', async () => {
    const { POST } = await import('../src/pages/api/staff/ai/generate-product-content');
    const res = await POST(ctx({ name: 'Kurti' }));

    expect((await res.json()).content.provider).toBe('workers_ai');
    expect(requestedProvider()).toBe('workers_ai');
  });

  it('does not treat the primary as a capped fallback detour', async () => {
    const { POST } = await import('../src/pages/api/staff/ai/generate-product-content');
    await POST(ctx({ name: 'Kurti' }));

    // Normal primary traffic must never consume the §24.2 hourly fallback
    // budget, or ordinary use would exhaust the outage backstop.
    expect(gateSawFallback()).toBe(false);
  });

  it('honours an explicit DeepSeek request without marking it a fallback', async () => {
    const { POST } = await import('../src/pages/api/staff/ai/generate-product-content');
    await POST(ctx({ name: 'Kurti', provider: 'deepseek' }));

    expect(requestedProvider()).toBe('deepseek');
    expect(gateSawFallback()).toBe(false);
    // An explicit choice must not spend a Workers AI budget check.
    expect(canUseWorkersAIBudget).not.toHaveBeenCalled();
  });

  it('falls back to DeepSeek when Workers AI is genuinely over budget', async () => {
    canUseWorkersAIBudget.mockResolvedValue(false);
    const { POST } = await import('../src/pages/api/staff/ai/generate-product-content');
    await POST(ctx({ name: 'Kurti' }));

    expect(requestedProvider()).toBe('deepseek');
    // This one IS a detour, so the hourly cap applies.
    expect(gateSawFallback()).toBe(true);
  });

  it('stays on the primary when the budget check itself fails', async () => {
    canUseWorkersAIBudget.mockRejectedValue(new Error('DO unreachable'));
    const { POST } = await import('../src/pages/api/staff/ai/generate-product-content');
    await POST(ctx({ name: 'Kurti' }));

    // A check failure is not evidence of an exhausted budget. Rerouting spend
    // to the paid provider on a transport error would be the wrong reflex.
    expect(requestedProvider()).toBe('workers_ai');
    expect(gateSawFallback()).toBe(false);
  });

  it('records usage against whichever provider actually ran', async () => {
    canUseWorkersAIBudget.mockResolvedValue(false);
    const { POST } = await import('../src/pages/api/staff/ai/generate-product-content');
    await POST(ctx({ name: 'Kurti' }));

    expect(recordAiUsage).toHaveBeenCalledTimes(1);
    expect(recordAiUsage.mock.calls[0][1]).toBe('deepseek');
  });

  it('surfaces a 429 rather than silently generating when the gate refuses', async () => {
    checkAiProviderAllowed.mockResolvedValue({ allowed: false, code: 'AI_FALLBACK_CAP_REACHED' });
    const { POST } = await import('../src/pages/api/staff/ai/generate-product-content');
    const res = await POST(ctx({ name: 'Kurti' }));

    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('AI_FALLBACK_CAP_REACHED');
    expect(generateProductContent).not.toHaveBeenCalled();
  });
});

describe('library-level default', () => {
  it('defaults to Workers AI when no provider is passed', async () => {
    vi.resetModules();
    vi.doUnmock('../src/lib/ai-content');
    const workersRun = vi.fn().mockResolvedValue({
      response: JSON.stringify({
        description: 'Workers AI copy long enough to clear the minimum length check applied to generated product content.',
        metaTitle: 'Title',
        metaDescription: 'Meta',
      }),
    });
    const actual = await vi.importActual<any>('../src/lib/ai-content');

    // A DeepSeek key is present and would be used if it were still primary.
    const result = await actual.generateProductContent(
      { name: 'Kurti' },
      { DEEPSEEK_API_KEY: 'k', AI: { run: workersRun } },
    );

    expect(result.provider).toBe('workers_ai');
    expect(workersRun).toHaveBeenCalledTimes(1);
    vi.resetModules();
  });
});
