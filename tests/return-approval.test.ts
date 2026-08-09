import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pure logic tests for the return reconciliation (RET-1 / RET-2).
import { evaluateReturnRequest, type ReturnItem } from '../src/pages/api/staff/returns/[id]/approve';

function bought(map: Record<string, { qty: number; unit: number }>) {
  return new Map(Object.entries(map));
}

describe('RET-1 / RET-2: evaluateReturnRequest', () => {
  it('valid full return refunds the full line value', () => {
    const r = evaluateReturnRequest({
      items: [{ variant_id: 'v1', quantity: 2 }],
      purchased: bought({ v1: { qty: 2, unit: 500 } }),
      alreadyReturned: new Map(),
      paymentAmount: 1000,
      alreadyRefunded: 0,
    });
    expect(r.ok).toBe(true);
    expect(r.returnedValue).toBe(1000);
    expect(r.refundAmount).toBe(1000);
  });

  it('RET-2: partial return refunds only the returned line value, not the full payment', () => {
    const r = evaluateReturnRequest({
      items: [{ variant_id: 'v1', quantity: 1 }],
      purchased: bought({ v1: { qty: 2, unit: 500 } }),
      alreadyReturned: new Map(),
      paymentAmount: 1000,
      alreadyRefunded: 0,
    });
    // Before the fix this returned 1000 (full payment). Now it is 500.
    expect(r.ok).toBe(true);
    expect(r.returnedValue).toBe(500);
    expect(r.refundAmount).toBe(500);
  });

  it('RET-1: rejects a variant that is not part of the order', () => {
    const r = evaluateReturnRequest({
      items: [{ variant_id: 'evil', quantity: 1 }],
      purchased: bought({ v1: { qty: 2, unit: 500 } }),
      alreadyReturned: new Map(),
      paymentAmount: 1000,
      alreadyRefunded: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('RETURN_VARIANT_NOT_IN_ORDER');
  });

  it('RET-1: rejects quantity exceeding purchased', () => {
    const r = evaluateReturnRequest({
      items: [{ variant_id: 'v1', quantity: 3 }],
      purchased: bought({ v1: { qty: 2, unit: 500 } }),
      alreadyReturned: new Map(),
      paymentAmount: 1000,
      alreadyRefunded: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('RETURN_QTY_EXCEEDS_PURCHASED');
  });

  it('RET-1: cumulative across returns cannot exceed purchased', () => {
    const r = evaluateReturnRequest({
      items: [{ variant_id: 'v1', quantity: 2 }],
      purchased: bought({ v1: { qty: 2, unit: 500 } }),
      alreadyReturned: new Map([['v1', 1]]),
      paymentAmount: 1000,
      alreadyRefunded: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('RETURN_QTY_EXCEEDS_PURCHASED');
  });

  it('RET-2: refund capped at amount actually paid', () => {
    const r = evaluateReturnRequest({
      items: [{ variant_id: 'v1', quantity: 2 }],
      purchased: bought({ v1: { qty: 2, unit: 500 } }),
      alreadyReturned: new Map(),
      paymentAmount: 600,
      alreadyRefunded: 0,
    });
    expect(r.refundAmount).toBe(600);
  });

  it('RET-2: refund capped at paid minus prior refunds', () => {
    const r = evaluateReturnRequest({
      items: [{ variant_id: 'v1', quantity: 2 }],
      purchased: bought({ v1: { qty: 2, unit: 500 } }),
      alreadyReturned: new Map(),
      paymentAmount: 1000,
      alreadyRefunded: 400,
    });
    expect(r.refundAmount).toBe(600);
  });

  it('rejects invalid / non-positive / fractional quantities', () => {
    for (const qty of [0, -1, 1.5, NaN]) {
      const r = evaluateReturnRequest({
        items: [{ variant_id: 'v1', quantity: qty as number }],
        purchased: bought({ v1: { qty: 2, unit: 500 } }),
        alreadyReturned: new Map(),
        paymentAmount: 1000,
        alreadyRefunded: 0,
      });
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_RETURN_QUANTITY');
    }
  });

  it('rejects empty return items', () => {
    const r = evaluateReturnRequest({
      items: [],
      purchased: bought({ v1: { qty: 2, unit: 500 } }),
      alreadyReturned: new Map(),
      paymentAmount: 1000,
      alreadyRefunded: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('EMPTY_RETURN_ITEMS');
  });
});

// ── Endpoint integration (RET-3): no double restock on replay ──────────────
const ctx = (id: string) =>
  ({
    params: { id },
    request: new Request(`https://x/api/staff/returns/${id}/approve`, { method: 'POST' }),
    locals: { runtime: { env: {} as any } },
  }) as unknown as import('astro').APIContext;

async function makeEnv(state: { rrStatus: string; restockCalls: number[]; items_json: string; hasPayment: boolean }) {
  const query = (sql: string) => {
    if (sql.includes('FROM return_requests WHERE id')) {
      return { first: async () => ({ id: 'rr1', order_id: 'o1', items_json: state.items_json, status: state.rrStatus, refund_amount_paisa: 0 }) };
    }
    if (sql.includes('FROM orders WHERE id')) {
      return { first: async () => ({ id: 'o1', status: 'delivered', payment_status: 'paid', total_paisa: 1000, advance_paisa: 0, payment_method: 'uddoktapay' }) };
    }
    if (sql.includes('FROM order_items')) {
      return { all: async () => ({ results: [{ variant_id: 'v1', quantity: 2, unit_price_paisa: 500 }] }) };
    }
    if (sql.includes("status IN ('approved','completed')") && sql.includes('items_json')) {
      return { all: async () => ({ results: [] }) };
    }
    if (sql.includes('SUM(refund_amount_paisa)')) {
      return { first: async () => ({ total: 0 }) };
    }
    if (sql.includes('FROM payments WHERE order_id')) {
      return { first: async () => (state.hasPayment ? { id: 'p1', invoice_id: 'inv1', amount_paisa: 1000, status: 'paid' } : null) };
    }
    if (sql.includes('UPDATE return_requests SET status =')) {
      const changes = state.rrStatus === 'pending' ? 1 : 0;
      if (changes === 1) state.rrStatus = 'approved';
      return { run: async () => ({ meta: { changes } }) };
    }
    return { first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 1 } }) };
  };
  const db = {
    prepare: vi.fn((sql: string) => ({ bind: vi.fn(() => query(sql)) })),
    batch: vi.fn(async (stmts: unknown[]) => stmts.map(() => ({ meta: { changes: 1 } }))),
  };
  return { DB: db, UDDOKTAPAY_API_KEY: 'k', UDDOKTAPAY_BASE_URL: 'https://x' } as any;
}

vi.mock('../src/lib/env', () => ({ getEnv: (c: any) => c.locals.runtime.env }));
vi.mock('../src/lib/rbac', () => ({
  requireAuth: async () => ({ id: 'u1', role: 'manager' }),
  requirePermission: () => {},
  RbacError: class extends Error {
    toResponse() { return new Response('', { status: 403 }); }
  },
}));
vi.mock('../src/lib/critical-auth', () => ({
  requireRecentStaffSession: async () => {},
  CriticalAuthError: class extends Error {
    toResponse() { return new Response('', { status: 403 }); }
  },
}));
vi.mock('../src/lib/order-state-machine', () => ({ canTransition: () => true }));
vi.mock('../src/lib/payments', () => ({ verifyUddoktaPayment: async () => ({ status: 'paid' }) }));
vi.mock('../src/lib/integrations/uddoktapay', () => ({ UddoktaPayClient: class { async refundPayment() { return { ok: true }; } } }));
vi.mock('../src/lib/audit', async (orig) => {
  const o = await orig() as any;
  return { ...o, prepareAuditLogInsert: async () => ({}) };
});
vi.mock('../src/lib/do-client', () => ({
  doAdjustStock: vi.fn(async () => {
    const calls = (globalThis as any).__restockCalls ?? ((globalThis as any).__restockCalls = []);
    calls.push(1);
    return { ok: true, previous_stock: 10, new_stock: 12, adjustment_id: 'a' };
  }),
}));

import { POST } from '../src/pages/api/staff/returns/[id]/approve';

describe('RET-3: return approval is idempotent (no double restock)', () => {
  beforeEach(() => { (globalThis as any).__restockCalls = []; });

  it('replaying approval does not restock twice', async () => {
    const state = { rrStatus: 'pending', restockCalls: [], items_json: JSON.stringify([{ variant_id: 'v1', quantity: 1 }]), hasPayment: true };
    const env = await makeEnv(state);
    const req = ctx('rr1');
    (req as any).locals.runtime.env = env;

    const first = await POST(req);
    const firstData = await first.json();
    expect(firstData.ok).toBe(true);
    expect((globalThis as any).__restockCalls.length).toBe(1);

    // Replay: status is now 'approved', must short-circuit without restock.
    const req2 = ctx('rr1');
    (req2 as any).locals.runtime.env = env;
    const second = await POST(req2);
    const secondData = await second.json();
    expect(secondData.ok).toBe(true);
    expect(secondData.code).toBe('ALREADY_PROCESSED');
    expect((globalThis as any).__restockCalls.length).toBe(1);
  });

  it('RET-1 at endpoint: variant not in order is rejected before restock', async () => {
    const state = { rrStatus: 'pending', restockCalls: [], items_json: JSON.stringify([{ variant_id: 'evil', quantity: 1 }]), hasPayment: true };
    const env = await makeEnv(state);
    const req = ctx('rr1');
    (req as any).locals.runtime.env = env;
    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBe(409);
    expect(data.code).toBe('RETURN_VARIANT_NOT_IN_ORDER');
    expect((globalThis as any).__restockCalls.length).toBe(0);
  });
});
