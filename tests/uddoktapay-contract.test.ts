/**
 * N-28: UddoktaPay integration contract.
 *
 * Every assertion here is pinned to the provider's documented API, not to the
 * shape the previous implementation happened to send. The old code called
 * /api/checkout, sent invoice_id/currency/customer_phone, demanded an HMAC on
 * webhooks and refunded by invoice id — none of which the provider supports,
 * which is why the integration could never have completed a payment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { UddoktaPayClient, normalizeBaseUrl, timingSafeEqualString } from '../src/lib/integrations/uddoktapay';
import { bindProviderInvoice, isValidProviderInvoiceId } from '../src/lib/payment-invoice-binding';
import { normalizeEmail } from '../src/lib/email-address';
import type { VerifiedPayment } from '../src/lib/payments';

const MIGRATIONS = resolve('./db/migrations');

const API_KEY = 'aBc123XyZ456contractkey';
const BASE = 'https://zabir.paymently.io';

function env(overrides: Record<string, unknown> = {}) {
  return { UDDOKTAPAY_API_KEY: API_KEY, UDDOKTAPAY_BASE_URL: BASE, ...overrides } as any;
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => text,
    json: async () => JSON.parse(text),
  } as unknown as Response;
}

const CHECKOUT_INPUT = {
  paymentId: 'pay-local-1',
  amountPaisa: 125050,
  customerName: 'Ayesha Rahman',
  customerEmail: 'ayesha@example.com',
  orderId: 'ord-1',
  redirectUrl: `${BASE.replace('zabir.paymently.io', 'zabirboutiques.com')}/api/payments/callback`,
  cancelUrl: 'https://zabirboutiques.com/cart',
  type: 'full' as const,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('base URL normalization', () => {
  it('strips a trailing slash and an accidental trailing /api', () => {
    expect(normalizeBaseUrl('https://zabir.paymently.io/')).toBe(BASE);
    expect(normalizeBaseUrl('https://zabir.paymently.io/api')).toBe(BASE);
    expect(normalizeBaseUrl('https://zabir.paymently.io/api/')).toBe(BASE);
    expect(normalizeBaseUrl('https://zabir.paymently.io')).toBe(BASE);
  });

  it('falls back to the provider default for empty or unparseable config', () => {
    expect(normalizeBaseUrl(undefined)).toBe('https://payment.uddoktapay.com');
    expect(normalizeBaseUrl('not a url')).toBe('https://payment.uddoktapay.com');
  });

  it('never produces a doubled /api segment in the request URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ status: true, payment_url: `${BASE}/pay/abc` }),
    );
    global.fetch = fetchMock;
    await new UddoktaPayClient(env({ UDDOKTAPAY_BASE_URL: `${BASE}/api/` })).createCheckout(CHECKOUT_INPUT);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/checkout-v2`);
  });
});

describe('create charge', () => {
  it('POSTs the documented URL, headers and body fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ status: true, payment_url: `${BASE}/pay/abc` }),
    );
    global.fetch = fetchMock;

    const result = await new UddoktaPayClient(env()).createCheckout(CHECKOUT_INPUT);
    expect(result.ok).toBe(true);
    expect(result.paymentUrl).toBe(`${BASE}/pay/abc`);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/api/checkout-v2`);
    expect(init.method).toBe('POST');
    expect(init.headers['RT-UDDOKTAPAY-API-KEY']).toBe(API_KEY);
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers.Accept).toBe('application/json');

    const body = JSON.parse(init.body);
    expect(body.full_name).toBe('Ayesha Rahman');
    expect(body.email).toBe('ayesha@example.com');
    // Integer paisa -> fixed two-decimal BDT string.
    expect(body.amount).toBe('1250.50');
    expect(body.return_type).toBe('GET');
    expect(body.redirect_url).toBe(CHECKOUT_INPUT.redirectUrl);
    expect(body.cancel_url).toBe(CHECKOUT_INPUT.cancelUrl);
    expect(body.metadata.payment_id).toBe('pay-local-1');
    expect(body.metadata.order_id).toBe('ord-1');
    expect(body.metadata.type).toBe('full');
    expect(typeof body.metadata.correlation_id).toBe('string');

    // Fields the provider does not document must not be sent.
    expect(body.invoice_id).toBeUndefined();
    expect(body.currency).toBeUndefined();
    expect(body.customer_name).toBeUndefined();
    expect(body.customer_phone).toBeUndefined();
  });

  it('never puts the API key or a secret in the request body or metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ status: true, payment_url: `${BASE}/pay/abc` }),
    );
    global.fetch = fetchMock;
    await new UddoktaPayClient(env()).createCheckout(CHECKOUT_INPUT);
    expect(fetchMock.mock.calls[0][1].body).not.toContain(API_KEY);
  });

  it('returns NOT_CONFIGURED without calling the provider when the secret is absent', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;
    const result = await new UddoktaPayClient(env({ UDDOKTAPAY_API_KEY: '' })).createCheckout(CHECKOUT_INPUT);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('NOT_CONFIGURED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a non-JSON provider response as BAD_RESPONSE rather than throwing', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse('<html>502 Bad Gateway</html>'));
    const result = await new UddoktaPayClient(env()).createCheckout(CHECKOUT_INPUT);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('BAD_RESPONSE');
  });

  it('rejects a payment_url that is not HTTPS on the configured provider origin', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ status: true, payment_url: 'https://evil.example.net/pay/abc' }),
    );
    const result = await new UddoktaPayClient(env()).createCheckout(CHECKOUT_INPUT);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('UNTRUSTED_PAYMENT_URL');
  });

  it('rejects status:false even when a payment_url is present', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ status: false, message: 'nope', payment_url: `${BASE}/pay/abc` }),
    );
    const result = await new UddoktaPayClient(env()).createCheckout(CHECKOUT_INPUT);
    expect(result.ok).toBe(false);
  });

  it('does not retry after a timeout (a retry could double-charge)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(
      Object.assign(new DOMException('aborted', 'AbortError')),
    );
    global.fetch = fetchMock;
    const result = await new UddoktaPayClient(env()).createCheckout(CHECKOUT_INPUT);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('TIMEOUT');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('verify payment status mapping', () => {
  async function verifyWith(body: unknown): Promise<VerifiedPayment> {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(body));
    return new UddoktaPayClient(env()).verifyPayment('inv-123456');
  }

  it('maps COMPLETED to paid and captures the refund fields', async () => {
    const result = await verifyWith({
      status: 'COMPLETED', amount: '1250.50', invoice_id: 'inv-123456',
      transaction_id: 'TRX99', payment_method: 'bkash',
      metadata: { payment_id: 'pay-local-1', order_id: 'ord-1' },
    });
    expect(result.status).toBe('paid');
    expect(result.amountPaisa).toBe(125050);
    expect(result.transactionId).toBe('TRX99');
    expect(result.paymentMethod).toBe('bkash');
  });

  it('maps PENDING to pending', async () => {
    expect((await verifyWith({ status: 'PENDING' })).status).toBe('pending');
  });

  it('maps ERROR to failed', async () => {
    expect((await verifyWith({ status: 'ERROR' })).status).toBe('failed');
  });

  it('treats an undocumented status as not-paid', async () => {
    for (const status of ['PROCESSING', 'EXPIRED', 'SUCCESS', 'completed', '']) {
      expect((await verifyWith({ status })).status).not.toBe('paid');
    }
  });

  it('treats a non-JSON verify response as not-paid', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse('nonsense not json'));
    const result = await new UddoktaPayClient(env()).verifyPayment('inv-123456');
    expect(result.status).toBe('failed');
  });
});

describe('webhook authentication', () => {
  function request(headers: Record<string, string>) {
    return new Request('https://zabirboutiques.com/api/payments/webhook', {
      method: 'POST',
      headers,
      body: JSON.stringify({ invoice_id: 'inv-123456' }),
    });
  }

  it('accepts the documented API-key header with no HMAC signature', async () => {
    const parsed = await new UddoktaPayClient(env()).parseWebhook(
      request({ 'RT-UDDOKTAPAY-API-KEY': API_KEY }),
    );
    expect(parsed).not.toBeNull();
  });

  it('rejects a wrong key and a missing key', async () => {
    const client = new UddoktaPayClient(env());
    expect(await client.parseWebhook(request({ 'RT-UDDOKTAPAY-API-KEY': 'wrong' }))).toBeNull();
    expect(await client.parseWebhook(request({}))).toBeNull();
  });

  it('compares alphanumeric keys correctly (a hex-only comparator would not)', () => {
    // 'zz' is not hex; a hex comparator decodes it to NaN bytes and can
    // report equality against any other non-hex string of the same length.
    expect(timingSafeEqualString('zzzz', 'zzzz')).toBe(true);
    expect(timingSafeEqualString('zzzz', 'zzzy')).toBe(false);
    expect(timingSafeEqualString(API_KEY, API_KEY)).toBe(true);
    expect(timingSafeEqualString(API_KEY, API_KEY + 'x')).toBe(false);
    expect(timingSafeEqualString('', API_KEY)).toBe(false);
  });
});

describe('refund contract', () => {
  it('sends transaction_id, payment_method, amount, product_name and reason', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: true }));
    global.fetch = fetchMock;

    await new UddoktaPayClient(env()).refundPayment({
      transactionId: 'TRX99',
      paymentMethod: 'bkash',
      amountPaisa: 50000,
      productName: 'Order ord-1',
      reason: 'return_approved',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/api/refund-payment`);
    expect(init.headers['RT-UDDOKTAPAY-API-KEY']).toBe(API_KEY);
    const body = JSON.parse(init.body);
    expect(body.transaction_id).toBe('TRX99');
    expect(body.payment_method).toBe('bkash');
    expect(body.amount).toBe('500.00');
    expect(body.product_name).toBe('Order ord-1');
    expect(body.reason).toBe('return_approved');
    // The old implementation refunded by invoice id, which the API rejects.
    expect(body.invoice_id).toBeUndefined();
  });
});

describe('audit redaction', () => {
  it('keeps the payment URL, email and sender number out of the audit row', async () => {
    const audited: string[] = [];
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        status: true,
        payment_url: `${BASE}/pay/secret-token`,
        email: 'ayesha@example.com',
        sender_number: '01712345678',
        full_name: 'Ayesha Rahman',
      }),
    );
    const db = {
      prepare: () => ({ bind: (...args: unknown[]) => { audited.push(JSON.stringify(args)); return { run: async () => ({ meta: { changes: 1 } }) }; } }),
    } as unknown as D1Database;

    await new UddoktaPayClient(env({ DB: db })).createCheckout(CHECKOUT_INPUT);

    const all = audited.join('\n');
    expect(all).not.toContain('secret-token');
    expect(all).not.toContain('ayesha@example.com');
    expect(all).not.toContain('01712345678');
    expect(all).not.toContain(API_KEY);
  });
});

describe('provider invoice binding', () => {
  function buildDb(): DatabaseSync {
    const raw = new DatabaseSync(':memory:');
    raw.exec(readFileSync(resolve(MIGRATIONS, '0001_initial_v6_8a_schema.sql'), 'utf8'));
    raw.exec(readFileSync(resolve(MIGRATIONS, '0062_payments_transaction_fields.sql'), 'utf8'));
    raw.exec(readFileSync(resolve(MIGRATIONS, '0063_payments_payment_method.sql'), 'utf8'));
    raw.exec(readFileSync(resolve(MIGRATIONS, '0065_payments_provider_invoice_id.sql'), 'utf8'));
    raw.exec(readFileSync(resolve(MIGRATIONS, '0066_payments_provider_invoice_unique.sql'), 'utf8'));
    raw.exec(`
      INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, created_at, updated_at)
      VALUES ('ord-1','ORD-1','+8801700000000','N','A',125050,0,0,125050,'uddoktapay','pending','review','pending_review','2026-01-01','2026-01-01');
      INSERT INTO payments (id, order_id, invoice_id, provider, amount_paisa, status, created_at, updated_at)
      VALUES ('p1','ord-1','pay-local-1','uddoktapay',125050,'pending','2026-01-01','2026-01-01');
    `);
    return raw;
  }

  function d1(raw: DatabaseSync): D1Database {
    return {
      prepare: (sql: string) => {
        let bound: unknown[] = [];
        const api = {
          bind: (...v: unknown[]) => { bound = v; return api; },
          first: async () => (raw.prepare(sql) as any).all(...bound)[0] ?? null,
          run: async () => ({ meta: { changes: Number((raw.prepare(sql) as any).run(...bound).changes ?? 0) } }),
        };
        return api;
      },
    } as unknown as D1Database;
  }

  const verified = (over: Partial<VerifiedPayment> = {}): VerifiedPayment => ({
    status: 'paid',
    amountPaisa: 125050,
    verifiedInvoiceId: 'INV9ABCDEF',
    metadata: { payment_id: 'pay-local-1', order_id: 'ord-1' },
    transactionId: 'TRX99',
    paymentMethod: 'bkash',
    rawResponse: '{}',
    ...over,
  });

  it('validates the provider invoice id shape', () => {
    expect(isValidProviderInvoiceId('INV9ABCDEF')).toBe(true);
    expect(isValidProviderInvoiceId('short')).toBe(false);
    expect(isValidProviderInvoiceId("' OR 1=1--")).toBe(false);
    expect(isValidProviderInvoiceId(null)).toBe(false);
    expect(isValidProviderInvoiceId('x'.repeat(200))).toBe(false);
  });

  it('binds the provider invoice and the refund fields to the matching payment', async () => {
    const raw = buildDb();
    const result = await bindProviderInvoice(d1(raw), 'INV9ABCDEF', verified(), '2026-01-02');
    expect(result).toMatchObject({ ok: true, localInvoiceId: 'pay-local-1', orderId: 'ord-1' });

    const row = raw.prepare(`SELECT provider_invoice_id, transaction_id, provider_payment_method FROM payments WHERE id='p1'`).get() as any;
    expect(row.provider_invoice_id).toBe('INV9ABCDEF');
    expect(row.transaction_id).toBe('TRX99');
    expect(row.provider_payment_method).toBe('bkash');
  });

  it('is idempotent when the same invoice is delivered twice', async () => {
    const raw = buildDb();
    const db = d1(raw);
    const first = await bindProviderInvoice(db, 'INV9ABCDEF', verified(), '2026-01-02');
    const second = await bindProviderInvoice(db, 'INV9ABCDEF', verified(), '2026-01-02');
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: true, alreadyBound: true });
  });

  it('rejects a second, different invoice against an already-bound payment', async () => {
    const raw = buildDb();
    const db = d1(raw);
    await bindProviderInvoice(db, 'INV9ABCDEF', verified(), '2026-01-02');
    const clash = await bindProviderInvoice(db, 'INVOTHER123', verified(), '2026-01-02');
    expect(clash).toEqual({ ok: false, code: 'INVOICE_ALREADY_BOUND' });
  });

  it('rejects an order id that does not match the payment', async () => {
    const raw = buildDb();
    const result = await bindProviderInvoice(
      d1(raw), 'INV9ABCDEF',
      verified({ metadata: { payment_id: 'pay-local-1', order_id: 'ord-somebody-else' } }),
      '2026-01-02',
    );
    expect(result).toEqual({ ok: false, code: 'ORDER_MISMATCH' });
  });

  it('rejects an amount that does not match the payment to the paisa', async () => {
    const raw = buildDb();
    const result = await bindProviderInvoice(d1(raw), 'INV9ABCDEF', verified({ amountPaisa: 100 }), '2026-01-02');
    expect(result).toEqual({ ok: false, code: 'AMOUNT_MISMATCH' });
  });

  it('rejects a charge whose metadata does not name a local payment', async () => {
    const raw = buildDb();
    const db = d1(raw);
    expect(await bindProviderInvoice(db, 'INV9ABCDEF', verified({ metadata: null }), '2026-01-02'))
      .toEqual({ ok: false, code: 'METADATA_MISSING' });
    expect(await bindProviderInvoice(db, 'INV9ABCDEF', verified({ metadata: { payment_id: 'nope', order_id: 'ord-1' } }), '2026-01-02'))
      .toEqual({ ok: false, code: 'PAYMENT_NOT_FOUND' });
  });
});

describe('customer email validation', () => {
  it('accepts a real address and normalizes it', () => {
    expect(normalizeEmail('  Ayesha@Example.COM ')).toEqual({ ok: true, email: 'ayesha@example.com' });
  });

  it('rejects anything that would have to be fabricated to pass', () => {
    for (const bad of ['', '   ', 'ayesha', 'ayesha@', '@example.com', 'a b@example.com', 'a@b', 'a@b.1', 'a@example.c', 'a'.repeat(300) + '@example.com']) {
      expect(normalizeEmail(bad).ok, bad).toBe(false);
    }
  });
});

describe('Cloudflare Workers compatibility', () => {
  const sources = [
    'src/lib/integrations/uddoktapay/client.ts',
    'src/lib/payment-invoice-binding.ts',
    'src/lib/email-address.ts',
    'src/pages/api/payments/callback.ts',
    'src/pages/api/payments/webhook.ts',
  ].map((f) => [f, readFileSync(resolve(f), 'utf8')] as const);

  it('uses no Node-only APIs and no axios', () => {
    for (const [file, src] of sources) {
      expect(/from ['"]node:/.test(src), file).toBe(false);
      expect(/require\(/.test(src), file).toBe(false);
      expect(/axios/.test(src), file).toBe(false);
      expect(/\bBuffer\b/.test(src), file).toBe(false);
    }
  });

  it('never hard-codes the API key or reads it from a PUBLIC_ variable', () => {
    for (const [file, src] of sources) {
      expect(/PUBLIC_[A-Z_]*UDDOKTAPAY/.test(src), file).toBe(false);
      expect(/UDDOKTAPAY_API_KEY\s*=\s*['"]/.test(src), file).toBe(false);
    }
  });

  it('gives the provider call an explicit timeout', () => {
    const client = sources.find(([f]) => f.endsWith('client.ts'))![1];
    expect(client).toContain('AbortController');
    expect(client).toContain('timeoutMs');
  });
});

describe('over-refund prevention', () => {
  function refundDb() {
    const raw = new DatabaseSync(':memory:');
    raw.exec(readFileSync(resolve(MIGRATIONS, '0001_initial_v6_8a_schema.sql'), 'utf8'));
    raw.exec(readFileSync(resolve(MIGRATIONS, '0064_payments_refunded_amount.sql'), 'utf8'));
    raw.exec(`
      INSERT INTO orders (id, order_number, phone, name, address, subtotal_paisa, delivery_paisa, discount_paisa, total_paisa, payment_method, payment_status, fraud_decision, status, created_at, updated_at)
      VALUES ('ord-1','ORD-1','+8801700000000','N','A',100000,0,0,100000,'uddoktapay','paid','review','payment_verified','2026-01-01','2026-01-01');
      INSERT INTO payments (id, order_id, invoice_id, provider, amount_paisa, status, created_at, updated_at)
      VALUES ('p1','ord-1','pay-local-1','uddoktapay',100000,'paid','2026-01-01','2026-01-01');
    `);
    const db = {
      prepare: (sql: string) => {
        let bound: unknown[] = [];
        const api = {
          bind: (...v: unknown[]) => { bound = v; return api; },
          first: async () => (raw.prepare(sql) as any).all(...bound)[0] ?? null,
          run: async () => ({ meta: { changes: Number((raw.prepare(sql) as any).run(...bound).changes ?? 0) } }),
        };
        return api;
      },
    } as unknown as D1Database;
    return { raw, db };
  }

  it('caps cumulative refunds at the captured amount', async () => {
    const { raw, db } = refundDb();
    const { claimRefundAmount } = await import('../src/lib/payment-refunds');

    expect(await claimRefundAmount(db, 'p1', 60000, '2026-01-02')).toEqual({ ok: true });
    expect(await claimRefundAmount(db, 'p1', 30000, '2026-01-02')).toEqual({ ok: true });
    // 60000 + 30000 + 20000 would exceed the 100000 captured.
    expect(await claimRefundAmount(db, 'p1', 20000, '2026-01-02')).toEqual({ ok: false, code: 'OVER_REFUND' });

    const row = raw.prepare(`SELECT refunded_amount_paisa FROM payments WHERE id='p1'`).get() as any;
    expect(row.refunded_amount_paisa).toBe(90000);
  });

  it('rejects a refund against a payment that was never captured', async () => {
    const { raw, db } = refundDb();
    raw.exec(`UPDATE payments SET status='pending' WHERE id='p1'`);
    const { claimRefundAmount } = await import('../src/lib/payment-refunds');
    expect(await claimRefundAmount(db, 'p1', 100, '2026-01-02')).toEqual({ ok: false, code: 'PAYMENT_NOT_REFUNDABLE' });
  });

  it('rejects non-positive and non-integer amounts', async () => {
    const { db } = refundDb();
    const { claimRefundAmount } = await import('../src/lib/payment-refunds');
    for (const bad of [0, -100, 12.5, NaN]) {
      expect((await claimRefundAmount(db, 'p1', bad, '2026-01-02')).ok).toBe(false);
    }
  });

  it('releasing a claim restores the refundable balance for a retry', async () => {
    const { raw, db } = refundDb();
    const { claimRefundAmount, releaseRefundAmount } = await import('../src/lib/payment-refunds');
    await claimRefundAmount(db, 'p1', 100000, '2026-01-02');
    expect(await claimRefundAmount(db, 'p1', 1, '2026-01-02')).toEqual({ ok: false, code: 'OVER_REFUND' });
    await releaseRefundAmount(db, 'p1', 100000, '2026-01-02');
    expect(await claimRefundAmount(db, 'p1', 100000, '2026-01-02')).toEqual({ ok: true });
    const row = raw.prepare(`SELECT refunded_amount_paisa FROM payments WHERE id='p1'`).get() as any;
    expect(row.refunded_amount_paisa).toBe(100000);
  });
});
