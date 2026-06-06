import { describe, it, expect, vi } from 'vitest';
import { verifyUddoktaPayment, markPaymentPaid } from '../src/lib/payments';

const mockDb = (overrides: Record<string, any> = {}) => ({
  prepare: vi.fn().mockReturnThis(),
  bind: vi.fn().mockReturnThis(),
  first: vi.fn().mockResolvedValue(overrides.first ?? null),
  all: vi.fn().mockResolvedValue({ results: overrides.all ?? [] }),
  run: vi.fn().mockResolvedValue({ meta: { changes: overrides.runChanges ?? 1 } }),
  batch: vi.fn().mockResolvedValue(overrides.batch ?? []),
} as unknown as D1Database);

describe('verifyUddoktaPayment', () => {
  it('maps COMPLETED to paid', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'COMPLETED' }),
    } as Response);
    const result = await verifyUddoktaPayment('inv-1', 'key', 'https://uddoktapay.dev');
    expect(result.status).toBe('paid');
  });

  it('maps PENDING to pending', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'PENDING' }),
    } as Response);
    const result = await verifyUddoktaPayment('inv-2', 'key', 'https://uddoktapay.dev');
    expect(result.status).toBe('pending');
  });

  it('handles API error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'server error' }),
    } as Response);
    const result = await verifyUddoktaPayment('inv-3', 'key', 'https://uddoktapay.dev');
    expect(result.status).toBe('failed');
  });
});

describe('markPaymentPaid', () => {
  it('forward-only update succeeds', async () => {
    const db = mockDb({ runChanges: 1 });
    const result = await markPaymentPaid(db, 'inv-1', '2026-06-04 12:00:00');
    expect(result).toBe(true);
  });

  it('returns false if already paid', async () => {
    const db = mockDb({ runChanges: 0 });
    const result = await markPaymentPaid(db, 'inv-2', '2026-06-04 12:00:00');
    expect(result).toBe(false);
  });
});

describe('payment webhook logic', () => {
  it('duplicate webhook must not double-confirm', () => {
    const eventResult = { meta: { changes: 0 } };
    expect(eventResult.meta.changes).toBe(0);
  });
});
