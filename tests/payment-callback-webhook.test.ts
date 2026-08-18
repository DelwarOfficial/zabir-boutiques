/**
 * N-28: the two ways a UddoktaPay payment gets reconciled — the browser
 * return callback and the server-to-server webhook — plus the guarantee that
 * they can race each other without double-applying anything.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyPayment = vi.fn();
const applyPaymentVerified = vi.fn();
const bindProviderInvoice = vi.fn();
const recordWebhookReceipt = vi.fn();
const processPaymentWebhookMessage = vi.fn();

vi.mock('../src/lib/env', () => ({ getEnv: (c: any) => c.locals.runtime.env }));
vi.mock('../src/lib/integrations/uddoktapay', async () => {
  const actual = await vi.importActual<any>('../src/lib/integrations/uddoktapay');
  return {
    ...actual,
    UddoktaPayClient: class { verifyPayment = verifyPayment; },
  };
});
vi.mock('../src/lib/payments', () => ({ applyPaymentVerified }));
vi.mock('../src/lib/payment-invoice-binding', async () => {
  const actual = await vi.importActual<any>('../src/lib/payment-invoice-binding');
  return { ...actual, bindProviderInvoice };
});
vi.mock('../src/lib/payment-webhook-ingress', async () => {
  const actual = await vi.importActual<any>('../src/lib/payment-webhook-ingress');
  return { ...actual, recordWebhookReceipt };
});
vi.mock('../src/queues/consumers', () => ({
  enqueuePaymentWebhook: vi.fn(),
  processPaymentWebhookMessage,
}));

const API_KEY = 'aBc123XyZ456contractkey';
const SITE = 'https://zabirboutiques.com';
const PROVIDER_INVOICE = 'INV9ABCDEF';

const db = {
  prepare: () => ({ bind: () => ({ first: async () => ({ order_number: 'ZB-1' }), run: async () => ({ meta: { changes: 1 } }) }) }),
} as unknown as D1Database;

function baseEnv() {
  return { DB: db, UDDOKTAPAY_API_KEY: API_KEY, UDDOKTAPAY_BASE_URL: 'https://zabir.paymently.io', PUBLIC_SITE_URL: SITE };
}

const paidVerification = {
  status: 'paid',
  amountPaisa: 125050,
  verifiedInvoiceId: PROVIDER_INVOICE,
  metadata: { payment_id: 'pay-local-1', order_id: 'ord-1' },
  transactionId: 'TRX99',
  paymentMethod: 'bkash',
  rawResponse: '{}',
};

beforeEach(() => {
  vi.clearAllMocks();
  verifyPayment.mockResolvedValue(paidVerification);
  bindProviderInvoice.mockResolvedValue({ ok: true, localInvoiceId: 'pay-local-1', orderId: 'ord-1', alreadyBound: false });
  applyPaymentVerified.mockResolvedValue({ ok: true, status: 'paid', isPartialPrepay: false, alreadyProcessed: false });
  recordWebhookReceipt.mockResolvedValue('recorded');
});

// ── callback ──────────────────────────────────────────────────────────────

function callbackCtx(query: string) {
  return {
    url: new URL(`${SITE}/api/payments/callback${query}`),
    request: new Request(`${SITE}/api/payments/callback${query}`),
    locals: { runtime: { env: baseEnv() } },
  } as any;
}

describe('GET /api/payments/callback', () => {
  it('verifies server-to-server and never trusts the query string as proof', async () => {
    const { GET } = await import('../src/pages/api/payments/callback');
    const res = await GET(callbackCtx(`?invoice_id=${PROVIDER_INVOICE}&status=COMPLETED&amount=999999`));

    expect(verifyPayment).toHaveBeenCalledWith(PROVIDER_INVOICE);
    expect(applyPaymentVerified).toHaveBeenCalledTimes(1);
    // The amount applied comes from the verification response, not the URL.
    expect(applyPaymentVerified.mock.calls[0][2].amountPaisa).toBe(125050);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toContain('payment=paid');
  });

  it('rejects a malformed invoice id without calling the provider', async () => {
    const { GET } = await import('../src/pages/api/payments/callback');
    const res = await GET(callbackCtx(`?invoice_id=${encodeURIComponent("' OR 1=1--")}`));
    expect(verifyPayment).not.toHaveBeenCalled();
    expect(res.headers.get('Location')).toContain('payment=cancelled');
  });

  it('shows a pending state without applying anything', async () => {
    verifyPayment.mockResolvedValue({ ...paidVerification, status: 'pending' });
    const { GET } = await import('../src/pages/api/payments/callback');
    const res = await GET(callbackCtx(`?invoice_id=${PROVIDER_INVOICE}`));
    expect(applyPaymentVerified).not.toHaveBeenCalled();
    expect(res.headers.get('Location')).toContain('payment=pending');
  });

  it('does not apply a payment whose metadata fails to bind', async () => {
    bindProviderInvoice.mockResolvedValue({ ok: false, code: 'AMOUNT_MISMATCH' });
    const { GET } = await import('../src/pages/api/payments/callback');
    const res = await GET(callbackCtx(`?invoice_id=${PROVIDER_INVOICE}`));
    expect(applyPaymentVerified).not.toHaveBeenCalled();
    expect(res.headers.get('Location')).toContain('payment=failed');
  });

  it('redirects only to the trusted local site, never to a provider payload', async () => {
    const { GET } = await import('../src/pages/api/payments/callback');
    const res = await GET(callbackCtx(`?invoice_id=${PROVIDER_INVOICE}`));
    expect(new URL(res.headers.get('Location')!).origin).toBe(SITE);
  });
});

// ── webhook ───────────────────────────────────────────────────────────────

function webhookCtx(headers: Record<string, string>, body: unknown, env = baseEnv()) {
  const request = new Request(`${SITE}/api/payments/webhook`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { request, url: new URL(request.url), locals: { runtime: { env }, cfContext: undefined } } as any;
}

const authHeader = { 'RT-UDDOKTAPAY-API-KEY': API_KEY };

describe('POST /api/payments/webhook', () => {
  it('authenticates with the API key alone — no HMAC signature required', async () => {
    const { POST } = await import('../src/pages/api/payments/webhook');
    const res = await POST(webhookCtx(authHeader, { invoice_id: PROVIDER_INVOICE }));
    expect(res.status).toBe(200);
    expect(processPaymentWebhookMessage).toHaveBeenCalledWith(expect.anything(), PROVIDER_INVOICE);
  });

  it('rejects a wrong or missing API key with 401', async () => {
    const { POST } = await import('../src/pages/api/payments/webhook');
    expect((await POST(webhookCtx({ 'RT-UDDOKTAPAY-API-KEY': 'wrong' }, { invoice_id: PROVIDER_INVOICE }))).status).toBe(401);
    expect((await POST(webhookCtx({}, { invoice_id: PROVIDER_INVOICE }))).status).toBe(401);
    expect(verifyPayment).not.toHaveBeenCalled();
  });

  it('treats the body as a notification only and re-verifies independently', async () => {
    const { POST } = await import('../src/pages/api/payments/webhook');
    await POST(webhookCtx(authHeader, { invoice_id: PROVIDER_INVOICE, status: 'COMPLETED', amount: '999999.00' }));
    expect(verifyPayment).toHaveBeenCalledWith(PROVIDER_INVOICE);
  });

  it('returns 400 for a non-JSON body and for a malformed invoice id', async () => {
    const { POST } = await import('../src/pages/api/payments/webhook');
    expect((await POST(webhookCtx(authHeader, 'not json'))).status).toBe(400);
    expect((await POST(webhookCtx(authHeader, { invoice_id: '!!' }))).status).toBe(400);
  });

  it('acknowledges a duplicate delivery with 2xx and does not reprocess it', async () => {
    recordWebhookReceipt.mockResolvedValue('duplicate');
    const { POST } = await import('../src/pages/api/payments/webhook');
    const res = await POST(webhookCtx(authHeader, { invoice_id: PROVIDER_INVOICE }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicate: true });
    expect(processPaymentWebhookMessage).not.toHaveBeenCalled();
  });

  it('acknowledges a still-pending payment without applying it', async () => {
    verifyPayment.mockResolvedValue({ ...paidVerification, status: 'pending' });
    const { POST } = await import('../src/pages/api/payments/webhook');
    const res = await POST(webhookCtx(authHeader, { invoice_id: PROVIDER_INVOICE }));
    expect(res.status).toBe(200);
    expect(processPaymentWebhookMessage).not.toHaveBeenCalled();
  });

  it('returns 503 rather than accepting anything when the key is unset', async () => {
    const { POST } = await import('../src/pages/api/payments/webhook');
    const env = { ...baseEnv(), UDDOKTAPAY_API_KEY: '' };
    expect((await POST(webhookCtx(authHeader, { invoice_id: PROVIDER_INVOICE }, env))).status).toBe(503);
  });

  it('never echoes the API key or a provider payload back to the caller', async () => {
    const { POST } = await import('../src/pages/api/payments/webhook');
    const res = await POST(webhookCtx(authHeader, { invoice_id: PROVIDER_INVOICE, sender_number: '01712345678' }));
    const text = await res.text();
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain('01712345678');
  });

  it('a webhook racing the callback binds once and applies once', async () => {
    // Second delivery sees the invoice already bound; dedup then short-circuits
    // before any reconciliation work is queued.
    bindProviderInvoice
      .mockResolvedValueOnce({ ok: true, localInvoiceId: 'pay-local-1', orderId: 'ord-1', alreadyBound: false })
      .mockResolvedValueOnce({ ok: true, localInvoiceId: 'pay-local-1', orderId: 'ord-1', alreadyBound: true });
    recordWebhookReceipt.mockResolvedValueOnce('recorded').mockResolvedValueOnce('duplicate');

    const { POST } = await import('../src/pages/api/payments/webhook');
    const first = await POST(webhookCtx(authHeader, { invoice_id: PROVIDER_INVOICE, event_id: 'e1' }));
    const second = await POST(webhookCtx(authHeader, { invoice_id: PROVIDER_INVOICE, event_id: 'e1' }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(processPaymentWebhookMessage).toHaveBeenCalledTimes(1);
  });
});
