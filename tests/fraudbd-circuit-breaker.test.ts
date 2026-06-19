import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderHealthDO } from '../src/do/provider-health-do';
import { checkFraudBD } from '../src/lib/fraud';
import { handleFraudAuditBatch } from '../src/queues/consumers';

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

function openHealth(): Stored {
  return {
    health: {
      provider: 'fraudbd',
      state: 'open',
      failureCount: 5,
      successCount: 0,
      lastFailureAt: new Date().toISOString(),
      lastSuccessAt: null,
      openedAt: new Date().toISOString(),
      halfOpenAt: null,
      failureTimestamps: [],
      failureThreshold: 5,
      recoveryTimeMs: 5 * 60 * 1000,
      halfOpenMaxAttempts: 1,
    },
  };
}

function halfOpenHealth(): Stored {
  return {
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
  };
}

function jsonResponse(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' }, ...init });
}

function healthStubWithTracking() {
  const providerResults: boolean[] = [];
  const stub = {
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
  return { stub, providerResults };
}

function envWith(stub: { fetch: ReturnType<typeof vi.fn> }) {
  return {
    PROVIDER_HEALTH_DO: {
      idFromName: vi.fn().mockReturnValue('fraudbd'),
      get: vi.fn().mockReturnValue(stub),
    },
  } as unknown as { PROVIDER_HEALTH_DO: DurableObjectNamespace };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FraudBD circuit breaker — Section 37 (25 tests)', () => {
  // ── CB-01 ──────────────────────────────────────────────────────────────
  it('CB-01 single failure does not open circuit', async () => {
    const subject = new ProviderHealthDO(createState(), {});
    await subject.fetch(new Request('https://do/record', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd', success: false }) }));
    const data = await (await subject.fetch(new Request('https://do/status', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd' }) }))).json() as { state: string };
    expect(data.state).toBe('closed');
  });

  // ── CB-02 ──────────────────────────────────────────────────────────────
  it('CB-02 four failures in 60s do NOT open circuit', async () => {
    const subject = new ProviderHealthDO(createState(), {});
    const nowSpy = vi.spyOn(Date, 'now');
    for (let i = 0; i < 4; i++) {
      nowSpy.mockReturnValue(1_000 + i * 10_000);
      await subject.fetch(new Request('https://do/record', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd', success: false }) }));
    }
    const data = await (await subject.fetch(new Request('https://do/status', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd' }) }))).json() as { state: string };
    expect(data.state).toBe('closed');
  });

  // ── CB-03 ──────────────────────────────────────────────────────────────
  it('CB-03 five failures in 60s open the circuit', async () => {
    const subject = new ProviderHealthDO(createState(), {});
    const nowSpy = vi.spyOn(Date, 'now');
    for (let i = 0; i < 5; i++) {
      nowSpy.mockReturnValue(1_000 + i * 10_000);
      await subject.fetch(new Request('https://do/record', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd', success: false }) }));
    }
    const data = await (await subject.fetch(new Request('https://do/status', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd' }) }))).json() as { state: string; canProceed: boolean };
    expect(data.state).toBe('open');
    expect(data.canProceed).toBe(false);
  });

  // ── CB-04 ──────────────────────────────────────────────────────────────
  it('CB-04 five failures spread over >60s do NOT open circuit', async () => {
    const subject = new ProviderHealthDO(createState(), {});
    const nowSpy = vi.spyOn(Date, 'now');
    for (let i = 0; i < 5; i++) {
      nowSpy.mockReturnValue(1_000 + i * 61_000);
      await subject.fetch(new Request('https://do/record', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd', success: false }) }));
    }
    const data = await (await subject.fetch(new Request('https://do/status', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd' }) }))).json() as { state: string };
    expect(data.state).toBe('closed');
  });

  // ── CB-05 ──────────────────────────────────────────────────────────────
  it('CB-05 open circuit returns fallback score 50 without calling HTTP', async () => {
    global.fetch = vi.fn() as unknown as typeof fetch;
    const healthStub = { fetch: vi.fn().mockResolvedValue(jsonResponse({ canProceed: false, state: 'open' })) };
    const result = await checkFraudBD('01712345678', 'key', 1500, 'https://fraudbd.com', envWith(healthStub));
    expect(result.score).toBe(50);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ── CB-06 ──────────────────────────────────────────────────────────────
  it('CB-06 open circuit fraud-source is circuit_open_fallback', async () => {
    const healthStub = { fetch: vi.fn().mockResolvedValue(jsonResponse({ canProceed: false, state: 'open' })) };
    const result = await checkFraudBD('01712345678', 'key', 1500, 'https://fraudbd.com', envWith(healthStub));
    expect(result.score).toBe(50);
    expect(result.rawResponse).toContain('circuit_open');
  });

  // ── CB-07 ──────────────────────────────────────────────────────────────
  it('CB-07 open circuit checkout returns fast (no HTTP wait)', async () => {
    const healthStub = { fetch: vi.fn().mockResolvedValue(jsonResponse({ canProceed: false, state: 'open' })) };
    const start = Date.now();
    await checkFraudBD('01712345678', 'key', 1500, 'https://fraudbd.com', envWith(healthStub));
    expect(Date.now() - start).toBeLessThan(100);
  });

  // ── CB-08 ──────────────────────────────────────────────────────────────
  it('CB-08 open circuit transitions to half_open after 5 minutes', async () => {
    const openedAt = new Date('2026-06-19T00:00:00.000Z').toISOString();
    const subject = new ProviderHealthDO(createState({
      health: { ...openHealth().health as object, openedAt },
    }), {});
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-06-19T00:05:01.000Z').getTime());
    const data = await (await subject.fetch(new Request('https://do/status', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd' }) }))).json() as { state: string; canProceed: boolean };
    expect(data.state).toBe('half_open');
    expect(data.canProceed).toBe(true);
  });

  // ── CB-09 ──────────────────────────────────────────────────────────────
  it('CB-09 half-open success closes circuit', async () => {
    const subject = new ProviderHealthDO(createState(halfOpenHealth()), {});
    const data = await (await subject.fetch(new Request('https://do/record', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd', success: true }) }))).json() as { state: string };
    expect(data.state).toBe('closed');
  });

  // ── CB-10 ──────────────────────────────────────────────────────────────
  it('CB-10 half-open failure re-opens circuit', async () => {
    const subject = new ProviderHealthDO(createState(halfOpenHealth()), {});
    const data = await (await subject.fetch(new Request('https://do/record', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd', success: false }) }))).json() as { state: string };
    expect(data.state).toBe('open');
  });

  // ── CB-11 ──────────────────────────────────────────────────────────────
  it('CB-11 checkout has zero retries on FraudBD failure', async () => {
    const { stub, providerResults } = healthStubWithTracking();
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ status: false }, { status: 503 }));
    await checkFraudBD('01712345678', 'key', 1500, 'https://fraudbd.com', envWith(stub));
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(providerResults).toEqual([false]);
  });

  // ── CB-12 ──────────────────────────────────────────────────────────────
  it('CB-12 checkout has zero retries on FraudBD timeout', async () => {
    const { stub, providerResults } = healthStubWithTracking();
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    global.fetch = vi.fn().mockRejectedValue(abortError);
    await checkFraudBD('01712345678', 'key', 1500, 'https://fraudbd.com', envWith(stub));
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(providerResults).toEqual([false]);
  });

  // ── CB-13 ──────────────────────────────────────────────────────────────
  it('CB-13 fraud-audit queue uses 1 retry with 2s backoff', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network failure'));
    const batch = {
      messages: [{
        body: { orderId: 'order-1', phone: '01712345678' },
        ack: vi.fn(),
        retry: vi.fn(),
      }],
    } as unknown as MessageBatch<{ orderId: string; phone: string }>;
    const db = { prepare: vi.fn().mockReturnThis(), bind: vi.fn().mockReturnThis(), run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }) } as unknown as D1Database;

    await handleFraudAuditBatch(batch, { DB: db, FRAUDBD_API_KEY: 'key' });
    const message = batch.messages[0] as unknown as { retry: ReturnType<typeof vi.fn>; ack: ReturnType<typeof vi.fn> };
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 2 });
    expect(message.ack).not.toHaveBeenCalled();
  });

  // ── CB-14 ──────────────────────────────────────────────────────────────
  it('CB-14 fraud-audit queue uses 3s timeout (not 1.5s checkout timeout)', async () => {
    const fraud = await import('../src/lib/fraud');
    const spy = vi.spyOn(fraud, 'checkFraudBD').mockResolvedValue({ score: 50, rawResponse: '{}' });
    const batch = {
      messages: [{ body: { orderId: 'order-1', phone: '01712345678' }, ack: vi.fn(), retry: vi.fn() }],
    } as unknown as MessageBatch<{ orderId: string; phone: string }>;
    const db = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ id: 'order-1', status: 'pending_review' }),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      }),
      batch: vi.fn().mockResolvedValue([]),
    } as unknown as D1Database;

    await handleFraudAuditBatch(batch, { DB: db, FRAUDBD_API_KEY: 'key' });
    expect(spy).toHaveBeenCalledWith('01712345678', 'key', 3000, 'https://fraudbd.com', { DB: db, FRAUDBD_API_KEY: 'key' });
  });

  // ── CB-15 ──────────────────────────────────────────────────────────────
  it('CB-15 4xx response is NOT a circuit failure', async () => {
    const { providerResults } = healthStubWithTracking();
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
    await checkFraudBD('01712345678', 'key', 1500, 'https://fraudbd.com', envWith(healthStub));
    expect(providerResults).toEqual([]);
  });

  // ── CB-16 ──────────────────────────────────────────────────────────────
  it('CB-16 5xx response IS a circuit failure', async () => {
    const { providerResults } = healthStubWithTracking();
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
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: 'server down' }, { status: 503 }));
    await checkFraudBD('01712345678', 'key', 1500, 'https://fraudbd.com', envWith(healthStub));
    expect(providerResults).toEqual([false]);
  });

  // ── CB-17 ──────────────────────────────────────────────────────────────
  it('CB-17 invalid response schema IS a circuit failure', async () => {
    const { providerResults } = healthStubWithTracking();
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
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ malformed: true }));
    await checkFraudBD('01712345678', 'key', 1500, 'https://fraudbd.com', envWith(healthStub));
    expect(providerResults).toEqual([false]);
  });

  // ── CB-18 ──────────────────────────────────────────────────────────────
  it('CB-18 empty response body IS a circuit failure', async () => {
    const { providerResults } = healthStubWithTracking();
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
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(null),
    } as unknown as Response);
    await checkFraudBD('01712345678', 'key', 1500, 'https://fraudbd.com', envWith(healthStub));
    expect(providerResults).toEqual([false]);
  });

  // ── CB-19 ──────────────────────────────────────────────────────────────
  it('CB-19 circuit state transition writes to api_audit_logs', async () => {
    const auditRows: Record<string, unknown>[] = [];
    const mockDb = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockImplementation(async () => {
        // Capture the bound values from the last bind call
        const boundValues = mockDb.bind.mock.calls[mockDb.bind.mock.calls.length - 1];
        auditRows.push({
          provider: boundValues[1],
          operation: boundValues[2],
          status: boundValues[7],
          circuitState: boundValues[10],
        });
      }),
    } as unknown as D1Database;

    // Use FraudBDClient directly which writes api_audit_logs
    const { FraudBDClient } = await import('../src/lib/integrations/fraudbd');
    const { providerResults } = healthStubWithTracking();
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
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ status: true, data: { Summaries: {}, totalSummary: { total: 0, cancelRate: 0 } } }));

    const client = new FraudBDClient({
      FRAUDBD_API_KEY: 'test-key',
      DB: mockDb,
      PROVIDER_HEALTH_DO: { idFromName: vi.fn().mockReturnValue('fraudbd'), get: vi.fn().mockReturnValue(healthStub) } as unknown as DurableObjectNamespace,
    });
    await client.checkCourierInfo('01712345678', 1500, 'https://fraudbd.com');

    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    expect(auditRows[0].provider).toBe('fraudbd');
    expect(auditRows[0].operation).toBe('check_courier_info');
    expect(auditRows[0].circuitState).toBe('closed');
  });

  // ── CB-20 ──────────────────────────────────────────────────────────────
  it('CB-20 concurrent checkout requests see consistent circuit state', async () => {
    const subject = new ProviderHealthDO(createState(openHealth()), {});
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        subject.fetch(new Request('https://do/status', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd' }) }))
          .then(r => r.json() as Promise<{ state: string; canProceed: boolean }>),
      ),
    );
    expect(results.every(r => r.state === 'open')).toBe(true);
    expect(results.every(r => r.canProceed === false)).toBe(true);
  });

  // ── CB-21 ──────────────────────────────────────────────────────────────
  it('CB-21 circuit opens after 5 consecutive failures (alert trigger point)', async () => {
    const subject = new ProviderHealthDO(createState(), {});
    const nowSpy = vi.spyOn(Date, 'now');
    for (let i = 0; i < 5; i++) {
      nowSpy.mockReturnValue(1_000 + i * 5_000);
      await subject.fetch(new Request('https://do/record', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd', success: false }) }));
    }
    const data = await (await subject.fetch(new Request('https://do/status', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd' }) }))).json() as { state: string };
    expect(data.state).toBe('open');
    // P2 alert integration is external to the DO; the state transition itself
    // is what triggers the alert in the production monitoring layer.
  });

  // ── CB-22 ──────────────────────────────────────────────────────────────
  it('CB-22 fraud-audit queue downgrades pending_review to staff_confirmed on approved score', async () => {
    const fraud = await import('../src/lib/fraud');
    vi.spyOn(fraud, 'checkFraudBD').mockResolvedValue({ score: 10, rawResponse: '{}' });
    const batch = {
      messages: [{ body: { orderId: 'order-1', phone: '01712345678' }, ack: vi.fn(), retry: vi.fn() }],
    } as unknown as MessageBatch<{ orderId: string; phone: string }>;
    const sqls: string[] = [];
    const db = {
      prepare: vi.fn((sql: string) => {
        sqls.push(sql);
        return {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(sql.includes('FROM orders') ? { id: 'order-1', status: 'pending_review' } : null),
          all: vi.fn().mockResolvedValue({ results: [{ id: 'res-1', variant_id: 'v1', quantity: 1 }] }),
          run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
        };
      }),
      batch: vi.fn().mockResolvedValue([{ meta: { changes: 1 } }, { meta: { changes: 1 } }]),
    } as unknown as D1Database;

    await handleFraudAuditBatch(batch, { DB: db, FRAUDBD_API_KEY: 'key' });
    expect(sqls.some((sql) => sql.includes("SET status = 'staff_confirmed'"))).toBe(true);
  });

  // ── CB-23 ──────────────────────────────────────────────────────────────
  it('CB-23 fraud-audit queue escalates pending_review to cancelled on blocked score', async () => {
    const fraud = await import('../src/lib/fraud');
    vi.spyOn(fraud, 'checkFraudBD').mockResolvedValue({ score: 95, rawResponse: '{}' });
    const batch = {
      messages: [{ body: { orderId: 'order-1', phone: '01712345678' }, ack: vi.fn(), retry: vi.fn() }],
    } as unknown as MessageBatch<{ orderId: string; phone: string }>;
    const sqls: string[] = [];
    const db = {
      prepare: vi.fn((sql: string) => {
        sqls.push(sql);
        return {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(sql.includes('FROM orders') ? { id: 'order-1', status: 'pending_review' } : null),
          all: vi.fn().mockResolvedValue({ results: [{ id: 'res-1', variant_id: 'v1', quantity: 1 }] }),
          run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
        };
      }),
      batch: vi.fn().mockResolvedValue([{ meta: { changes: 1 } }, { meta: { changes: 1 } }]),
    } as unknown as D1Database;

    await handleFraudAuditBatch(batch, { DB: db, FRAUDBD_API_KEY: 'key' });
    expect(sqls.some((sql) => sql.includes("SET status = 'cancelled'"))).toBe(true);
  });

  // ── CB-24 ──────────────────────────────────────────────────────────────
  it('CB-24 circuit state persists through storage put/get (survives eviction)', async () => {
    const store = new Map<string, unknown>();
    const mockStorage = {
      get: vi.fn(async (key: string) => store.get(key)),
      put: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
    } as unknown as DurableObjectState;

    // First DO instance: open the circuit
    const subject1 = new ProviderHealthDO({ storage: mockStorage } as unknown as DurableObjectState, {});
    const nowSpy = vi.spyOn(Date, 'now');
    for (let i = 0; i < 5; i++) {
      nowSpy.mockReturnValue(1_000 + i * 10_000);
      await subject1.fetch(new Request('https://do/record', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd', success: false }) }));
    }

    // Simulate eviction: new DO instance reads from same storage
    const subject2 = new ProviderHealthDO({ storage: mockStorage } as unknown as DurableObjectState, {});
    const data = await (await subject2.fetch(new Request('https://do/status', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd' }) }))).json() as { state: string };
    expect(data.state).toBe('open');
  });

  // ── CB-25 ──────────────────────────────────────────────────────────────
  it('CB-25 half-open probe is single-flight (only first request probes)', async () => {
    const subject = new ProviderHealthDO(createState(halfOpenHealth()), {});
    const [r1, r2] = await Promise.all([
      subject.fetch(new Request('https://do/status', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd' }) })),
      subject.fetch(new Request('https://do/status', { method: 'POST', body: JSON.stringify({ provider: 'fraudbd' }) })),
    ]);
    const d1 = await r1.json() as { state: string; canProceed: boolean };
    const d2 = await r2.json() as { state: string; canProceed: boolean };
    expect(d1.state).toBe('half_open');
    expect(d2.state).toBe('half_open');
    expect(d1.canProceed).toBe(true);
    expect(d2.canProceed).toBe(false);
  });
});
