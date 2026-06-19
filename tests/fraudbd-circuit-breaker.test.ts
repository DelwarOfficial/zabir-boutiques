import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderHealthDO } from '../src/do/provider-health-do';
import { checkFraudBD } from '../src/lib/fraud';

type Stored = Record<string, unknown>;

function createState(seed: Stored = {}) {
  const store = new Map<string, unknown>(Object.entries(seed));
  return {
    storage: {
      get: vi.fn(async (key: string) => store.get(key)),
      put: vi.fn(async (keyOrObj: string | Record<string, unknown>, value?: unknown) => {
        if (typeof keyOrObj === 'string') {
          store.set(keyOrObj, value);
          return;
        }
        for (const [k, v] of Object.entries(keyOrObj)) store.set(k, v);
      }),
    },
  } as unknown as DurableObjectState;
}

function jsonResponse(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' }, ...init });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FraudBD circuit breaker section 37 core cases', () => {
  it('CB-01 single failure does not open circuit', async () => {
    const state = createState();
    const subject = new ProviderHealthDO(state, {});

    await subject.fetch(new Request('https://do/record', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd', success: false }) }));
    const status = await subject.fetch(new Request('https://do/status', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd' }) }));
    const data = await status.json() as { state: string };

    expect(data.state).toBe('closed');
  });

  it('CB-03 five failures in 60s open the circuit', async () => {
    const state = createState();
    const subject = new ProviderHealthDO(state, {});
    const nowSpy = vi.spyOn(Date, 'now');

    for (let i = 0; i < 5; i++) {
      nowSpy.mockReturnValue(1_000 + i * 10_000);
      await subject.fetch(new Request('https://do/record', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd', success: false }) }));
    }

    const status = await subject.fetch(new Request('https://do/status', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd' }) }));
    const data = await status.json() as { state: string; canProceed: boolean };
    expect(data.state).toBe('open');
    expect(data.canProceed).toBe(false);
  });

  it('CB-04 five failures spread over more than 60s do not open circuit', async () => {
    const state = createState();
    const subject = new ProviderHealthDO(state, {});
    const nowSpy = vi.spyOn(Date, 'now');

    for (let i = 0; i < 5; i++) {
      nowSpy.mockReturnValue(1_000 + i * 61_000);
      await subject.fetch(new Request('https://do/record', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd', success: false }) }));
    }

    const status = await subject.fetch(new Request('https://do/status', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd' }) }));
    const data = await status.json() as { state: string };
    expect(data.state).toBe('closed');
  });

  it('CB-08 open circuit transitions to half_open after five minutes', async () => {
    const openedAt = new Date('2026-06-19T00:00:00.000Z').toISOString();
    const state = createState({
      health: {
        provider: 'fraudbd',
        state: 'open',
        failureCount: 5,
        successCount: 0,
        lastFailureAt: openedAt,
        lastSuccessAt: null,
        openedAt,
        halfOpenAt: null,
        failureTimestamps: [],
        failureThreshold: 5,
        recoveryTimeMs: 5 * 60 * 1000,
        halfOpenMaxAttempts: 1,
      },
    });
    const subject = new ProviderHealthDO(state, {});
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-06-19T00:05:01.000Z').getTime());

    const status = await subject.fetch(new Request('https://do/status', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd' }) }));
    const data = await status.json() as { state: string; canProceed: boolean };
    expect(data.state).toBe('half_open');
    expect(data.canProceed).toBe(true);
  });

  it('CB-09 half-open success closes circuit', async () => {
    const state = createState({
      health: {
        provider: 'fraudbd',
        state: 'half_open',
        failureCount: 5,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        openedAt: new Date().toISOString(),
        halfOpenAt: new Date().toISOString(),
        failureTimestamps: [],
        failureThreshold: 5,
        recoveryTimeMs: 5 * 60 * 1000,
        halfOpenMaxAttempts: 1,
      },
    });
    const subject = new ProviderHealthDO(state, {});

    const status = await subject.fetch(new Request('https://do/record', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd', success: true }) }));
    const data = await status.json() as { state: string };
    expect(data.state).toBe('closed');
  });

  it('CB-10 half-open failure re-opens circuit', async () => {
    const state = createState({
      health: {
        provider: 'fraudbd',
        state: 'half_open',
        failureCount: 5,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        openedAt: null,
        halfOpenAt: new Date().toISOString(),
        failureTimestamps: [],
        failureThreshold: 5,
        recoveryTimeMs: 5 * 60 * 1000,
        halfOpenMaxAttempts: 1,
      },
    });
    const subject = new ProviderHealthDO(state, {});

    const status = await subject.fetch(new Request('https://do/record', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd', success: false }) }));
    const data = await status.json() as { state: string };
    expect(data.state).toBe('open');
  });

  it('CB-05 open circuit returns fallback score 50 without calling HTTP', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const healthStub = {
      fetch: vi.fn().mockResolvedValue(jsonResponse({ canProceed: false, state: 'open' })),
    };
    const env = {
      PROVIDER_HEALTH_DO: {
        idFromName: vi.fn().mockReturnValue('fraudbd'),
        get: vi.fn().mockReturnValue(healthStub),
      },
    } as unknown as { PROVIDER_HEALTH_DO: DurableObjectNamespace };

    const result = await checkFraudBD('01712345678', 'key', 1500, 'https://fraudbd.com', env);
    expect(result.score).toBe(50);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('CB-15 4xx response does not record a circuit failure', async () => {
    const providerResults: boolean[] = [];
    const healthStub = {
      fetch: vi.fn().mockImplementation(async (_request: Request | string, init?: RequestInit) => {
        const url = new URL(typeof _request === 'string' ? _request : _request.url);
        if (url.pathname === '/status') return jsonResponse({ canProceed: true, state: 'closed' });
        if (url.pathname === '/record') {
          const body = JSON.parse(String(init?.body ?? '{}')) as { success: boolean };
          providerResults.push(body.success);
          return jsonResponse({ ok: true, state: 'closed' });
        }
        return jsonResponse({ ok: false }, { status: 400 });
      }),
    };
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad phone' }, { status: 422 }));

    await checkFraudBD('01712345678', 'key', 1500, 'https://fraudbd.com', {
      PROVIDER_HEALTH_DO: { idFromName: vi.fn().mockReturnValue('fraudbd'), get: vi.fn().mockReturnValue(healthStub) } as unknown as DurableObjectNamespace,
    });

    expect(providerResults).toEqual([]);
  });

  it('CB-17 malformed 200 body records a circuit failure', async () => {
    const providerResults: boolean[] = [];
    const healthStub = {
      fetch: vi.fn().mockImplementation(async (_request: Request | string, init?: RequestInit) => {
        const url = new URL(typeof _request === 'string' ? _request : _request.url);
        if (url.pathname === '/status') return jsonResponse({ canProceed: true, state: 'closed' });
        if (url.pathname === '/record') {
          const body = JSON.parse(String(init?.body ?? '{}')) as { success: boolean };
          providerResults.push(body.success);
          return jsonResponse({ ok: true, state: body.success ? 'closed' : 'closed' });
        }
        return jsonResponse({ ok: false }, { status: 400 });
      }),
    };
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ malformed: true }));

    await checkFraudBD('01712345678', 'key', 1500, 'https://fraudbd.com', {
      PROVIDER_HEALTH_DO: { idFromName: vi.fn().mockReturnValue('fraudbd'), get: vi.fn().mockReturnValue(healthStub) } as unknown as DurableObjectNamespace,
    });

    expect(providerResults).toEqual([false]);
  });
});
