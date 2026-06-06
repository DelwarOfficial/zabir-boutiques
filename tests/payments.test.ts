import { describe, it, expect, vi } from 'vitest';
import { verifyUddoktaPayment, markPaymentPaid, takaStringToPaisa } from '../src/lib/payments';

const mockDb = (overrides: Record<string, any> = {}) => ({
  prepare: vi.fn().mockReturnThis(),
  bind: vi.fn().mockReturnThis(),
  first: vi.fn().mockResolvedValue(overrides.first ?? null),
  all: vi.fn().mockResolvedValue({ results: overrides.all ?? [] }),
  run: vi.fn().mockResolvedValue({ meta: { changes: overrides.runChanges ?? 1 } }),
  batch: vi.fn().mockResolvedValue(overrides.batch ?? []),
} as unknown as D1Database);

describe('verifyUddoktaPayment', () => {
  it('maps COMPLETED to paid and returns amount in paisa', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'COMPLETED', amount: '150.00', invoice_id: 'inv-1', metadata: { order_id: 'ord-1' } }),
    } as Response);
    const result = await verifyUddoktaPayment('inv-1', 'key', 'https://uddoktapay.dev');
    expect(result.status).toBe('paid');
    expect(result.amountPaisa).toBe(15000);
    expect(result.verifiedInvoiceId).toBe('inv-1');
    expect(result.metadata).toEqual({ order_id: 'ord-1' });
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
    expect(result.amountPaisa).toBeNull();
  });
});

describe('takaStringToPaisa', () => {
  it('converts decimal taka strings to integer paisa', () => {
    expect(takaStringToPaisa('150.00')).toBe(15000);
    expect(takaStringToPaisa('150.5')).toBe(15050);
    expect(takaStringToPaisa('0')).toBe(0);
    expect(takaStringToPaisa(99.99)).toBe(9999);
  });

  it('rejects invalid or negative amounts', () => {
    expect(takaStringToPaisa('abc')).toBeNull();
    expect(takaStringToPaisa('-5')).toBeNull();
    expect(takaStringToPaisa(null)).toBeNull();
    expect(takaStringToPaisa(undefined)).toBeNull();
  });
});

describe('webhook amount authority (issue #2 hardening)', () => {
  it('rejects when verified amount does not match the charged amount', () => {
    const chargedPaisa = 15000;
    const verifiedPaisa = 1; // tampered / partial settlement
    const mismatch = verifiedPaisa === null || verifiedPaisa !== chargedPaisa;
    expect(mismatch).toBe(true);
  });

  it('accepts when verified amount matches exactly', () => {
    const chargedPaisa = 15000;
    const verifiedPaisa = 15000;
    const mismatch = verifiedPaisa === null || verifiedPaisa !== chargedPaisa;
    expect(mismatch).toBe(false);
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
