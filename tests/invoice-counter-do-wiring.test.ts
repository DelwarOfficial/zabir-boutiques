import { describe, it, expect } from 'vitest';
import { doNextInvoiceNumber } from '../src/lib/do-client';

/** In-memory fake InvoiceCounterDO namespace, one counter per dateKey. */
function fakeInvoiceCounterNamespace() {
  const counters: Record<string, number> = {};
  const calls: string[] = [];
  const ns = {
    idFromName: (name: string) => name,
    get: (name: string) => ({
      fetch: async (url: string, init?: { body?: string }) => {
        calls.push(name);
        if (url.includes('/next')) {
          const dateKey = name.split(':')[1];
          counters[dateKey] = (counters[dateKey] ?? 0) + 1;
          const seq = counters[dateKey];
          const receipt_no = `ZB-INV-${dateKey}-${seq.toString().padStart(4, '0')}`;
          return new Response(JSON.stringify({ ok: true, receipt_no, seq }));
        }
        return new Response(JSON.stringify({ ok: false }), { status: 400 });
      },
    }),
  };
  return { ns, counters, calls };
}

describe('INV-3: InvoiceCounterDO is actually called by createInvoice (not dead code)', () => {
  it('doNextInvoiceNumber calls the DO and returns a sequential serial', async () => {
    const { ns } = fakeInvoiceCounterNamespace();
    const env = { INVOICE_COUNTER_DO: ns as unknown as DurableObjectNamespace };

    const r1 = await doNextInvoiceNumber(env, '20260101', 'staff1');
    const r2 = await doNextInvoiceNumber(env, '20260101', 'staff1');

    expect(r1).toEqual({ receipt_no: 'ZB-INV-20260101-0001', seq: 1 });
    expect(r2).toEqual({ receipt_no: 'ZB-INV-20260101-0002', seq: 2 });
  });

  it('20 concurrent calls on the same day produce 20 distinct sequential serials (no D1 race)', async () => {
    const { ns } = fakeInvoiceCounterNamespace();
    const env = { INVOICE_COUNTER_DO: ns as unknown as DurableObjectNamespace };

    const results = await Promise.all(
      Array.from({ length: 20 }, () => doNextInvoiceNumber(env, '20260215', 'staff1')),
    );

    const serials = results.map((r) => r?.receipt_no);
    expect(new Set(serials).size).toBe(20); // all distinct
    const seqs = results.map((r) => r?.seq).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1)); // 1..20, no gaps
  });

  it('separate UTC days get independent counters', async () => {
    const { ns } = fakeInvoiceCounterNamespace();
    const env = { INVOICE_COUNTER_DO: ns as unknown as DurableObjectNamespace };

    const day1 = await doNextInvoiceNumber(env, '20260101', 'staff1');
    const day2 = await doNextInvoiceNumber(env, '20260102', 'staff1');
    expect(day1?.receipt_no).toBe('ZB-INV-20260101-0001');
    expect(day2?.receipt_no).toBe('ZB-INV-20260102-0001'); // restarts at 1
  });

  it('returns null (triggering the D1 fallback) when the DO is not bound', async () => {
    const result = await doNextInvoiceNumber({}, '20260101', 'staff1');
    expect(result).toBeNull();
  });

  it('createInvoice actually calls doNextInvoiceNumber, not just the D1 retry path', () => {
    const src = require('node:fs').readFileSync(require('node:path').resolve('./src/lib/invoices.ts'), 'utf8');
    expect(src).toContain('doNextInvoiceNumber(env, dateKey, input.cashierId)');
    // The D1 fallback still exists (env-unbound / free-tier case), but is
    // no longer the only path.
    expect(src).toContain('generateReceiptNoWithRetry(db, now)');
  });
});
