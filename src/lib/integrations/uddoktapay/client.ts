import { writeApiAuditLog } from '../../api-audit';
import { doCheckProviderHealth, doRecordProviderResult } from '../../do-client';
import type { PaymentProviderContract } from '../../contracts/payment-provider';
import type { PaymentStatus, VerifiedPayment } from '../../payments';
import type { CreateCheckoutInput, CreateCheckoutResult, RefundPaymentInput, RefundPaymentResult, UddoktaPayEnv } from './types';

function takaStringToPaisa(amount: unknown): number | null {
  if (typeof amount !== 'string' && typeof amount !== 'number') return null;
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/**
 * N-28: documented statuses are COMPLETED, PENDING and ERROR only. Anything
 * else — including values this map used to invent, like PROCESSING/EXPIRED —
 * must be treated as not-paid rather than guessed at.
 */
const STATUS_MAP: Record<string, PaymentStatus> = {
  COMPLETED: 'paid',
  PENDING: 'pending',
  ERROR: 'failed',
};

/**
 * Normalize a configured base URL to a bare origin+path with no trailing
 * slash and no trailing `/api`. Both are easy to paste in by accident and
 * would otherwise produce `/api/api/checkout-v2`, which 404s in a way that
 * looks like a provider outage rather than a config typo.
 */
export function normalizeBaseUrl(raw: string | undefined): string {
  const fallback = 'https://payment.uddoktapay.com';
  const value = (raw ?? '').trim();
  if (!value) return fallback;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fallback;
  }
  let path = url.pathname.replace(/\/+$/, '');
  if (/\/api$/i.test(path)) path = path.slice(0, -4);
  return `${url.origin}${path}`;
}

/** Timing-safe compare for arbitrary (non-hex) strings — the API key is alphanumeric. */
export function timingSafeEqualString(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  // Length is not secret, but bail before indexing so the loop below is
  // always over equal-length buffers.
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export class UddoktaPayClient implements PaymentProviderContract {
  constructor(private readonly env: UddoktaPayEnv) {}

  private async fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Provider bodies carry customer PII (email, sender_number) and payment
   * URLs. Audit rows are queryable by staff, so keep only what is needed to
   * debug a failure.
   */
  private redactForAudit(data: Record<string, unknown>): string {
    const safe: Record<string, unknown> = {};
    for (const key of ['status', 'message', 'invoice_id', 'transaction_id', 'payment_method', 'amount', 'date']) {
      if (data[key] !== undefined) safe[key] = data[key];
    }
    if (typeof data.payment_url === 'string') safe.payment_url = '[redacted]';
    if (data.email !== undefined) safe.email = '[redacted]';
    if (data.sender_number !== undefined) safe.sender_number = '[redacted]';
    if (data.full_name !== undefined) safe.full_name = '[redacted]';
    return JSON.stringify(safe);
  }

  /** Parse JSON defensively — an HTML error page must not throw past the caller. */
  private async readJson(res: Response): Promise<{ data: Record<string, unknown>; parsed: boolean }> {
    const text = await res.text().catch(() => '');
    try {
      const data = JSON.parse(text) as unknown;
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        return { data: data as Record<string, unknown>, parsed: true };
      }
      return { data: {}, parsed: false };
    } catch {
      return { data: {}, parsed: false };
    }
  }

  /**
   * Only forward the customer to a URL that is HTTPS and on the provider
   * origin we configured. A compromised or misconfigured response could
   * otherwise redirect a paying customer anywhere.
   */
  private isTrustedPaymentUrl(candidate: unknown): candidate is string {
    if (typeof candidate !== 'string' || candidate.length === 0) return false;
    try {
      const url = new URL(candidate);
      if (url.protocol !== 'https:') return false;
      return url.origin === new URL(this.baseUrl()).origin;
    } catch {
      return false;
    }
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();

    if (!this.env.UDDOKTAPAY_API_KEY) {
      // Fail loudly rather than sending an unauthenticated request that the
      // provider rejects with an opaque error.
      await this.audit('checkout', requestId, startedAt, 'error', 'NOT_CONFIGURED', JSON.stringify({ order_id: input.orderId }), '{"error":"not_configured"}', input.orderId, null, 'closed');
      return { ok: false, rawResponse: '{"error":"not_configured"}', errorCode: 'NOT_CONFIGURED' };
    }

    const health = await this.checkCircuit();
    if (!health.canProceed) {
      await this.audit('checkout', requestId, startedAt, 'circuit_open', 'CIRCUIT_OPEN', JSON.stringify({ order_id: input.orderId }), '{"error":"circuit_open"}', input.orderId, null, health.state);
      return { ok: false, rawResponse: '{"error":"circuit_open"}', errorCode: 'CIRCUIT_OPEN' };
    }

    // Echoed back through verify-payment, letting a callback prove it belongs
    // to this specific charge attempt rather than merely to this order.
    const correlationId = crypto.randomUUID();

    try {
      const res = await this.fetchWithTimeout(`${this.baseUrl()}/api/checkout-v2`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          full_name: input.customerName,
          email: input.customerEmail,
          amount: (input.amountPaisa / 100).toFixed(2),
          metadata: {
            payment_id: input.paymentId,
            order_id: input.orderId,
            type: input.type,
            correlation_id: correlationId,
          },
          redirect_url: input.redirectUrl,
          cancel_url: input.cancelUrl,
          ...(input.webhookUrl ? { webhook_url: input.webhookUrl } : {}),
          return_type: 'GET',
        }),
      });

      const { data, parsed } = await this.readJson(res);
      const rawResponse = JSON.stringify(data);
      const auditResponse = this.redactForAudit(data);

      if (!parsed) {
        await this.record(false);
        await this.audit('checkout', requestId, startedAt, 'error', 'BAD_RESPONSE', JSON.stringify({ order_id: input.orderId }), JSON.stringify({ http: res.status }), input.orderId, null, health.state);
        return { ok: false, rawResponse: JSON.stringify({ error: 'BAD_RESPONSE' }), errorCode: 'BAD_RESPONSE' };
      }

      // Documented success shape is { status: true, message, payment_url }.
      const ok = res.ok && data.status === true && this.isTrustedPaymentUrl(data.payment_url);
      await this.record(ok);
      await this.audit('checkout', requestId, startedAt, ok ? 'success' : 'error', ok ? null : `HTTP_${res.status}`, JSON.stringify({ order_id: input.orderId }), auditResponse, input.orderId, null, health.state);

      if (!ok) {
        return { ok: false, rawResponse, errorCode: res.ok ? 'UNTRUSTED_PAYMENT_URL' : `HTTP_${res.status}` };
      }
      return { ok: true, paymentUrl: data.payment_url as string, correlationId, rawResponse };
    } catch (err) {
      const code = err instanceof DOMException && err.name === 'AbortError' ? 'TIMEOUT' : 'REQUEST_FAILED';
      await this.record(false);
      await this.audit('checkout', requestId, startedAt, code === 'TIMEOUT' ? 'timeout' : 'error', code, JSON.stringify({ order_id: input.orderId }), JSON.stringify({ error: code }), input.orderId, null, health.state);
      // Deliberately not retried: a create-charge that timed out may still
      // have created a charge on the provider side, so a blind retry risks
      // double-charging the customer.
      return { ok: false, rawResponse: JSON.stringify({ error: code }), errorCode: code };
    }
  }

  async verifyPayment(invoiceId: string): Promise<VerifiedPayment> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const empty: VerifiedPayment = {
      status: 'failed', amountPaisa: null, verifiedInvoiceId: null,
      metadata: null, transactionId: null, paymentMethod: null, rawResponse: '',
    };

    if (!this.env.UDDOKTAPAY_API_KEY) {
      return { ...empty, rawResponse: JSON.stringify({ error: 'NOT_CONFIGURED' }) };
    }

    const health = await this.checkCircuit();
    if (!health.canProceed) {
      await this.audit('verify_payment', requestId, startedAt, 'circuit_open', 'CIRCUIT_OPEN', JSON.stringify({ invoice_id: invoiceId }), '{"error":"circuit_open"}', null, invoiceId, health.state);
      return { ...empty, rawResponse: '{"error":"circuit_open"}' };
    }

    try {
      const res = await this.fetchWithTimeout(`${this.baseUrl()}/api/verify-payment`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ invoice_id: invoiceId }),
      });
      const { data, parsed } = await this.readJson(res);
      const rawResponse = JSON.stringify(data);

      if (!res.ok || !parsed || typeof data.status !== 'string') {
        await this.record(false);
        await this.audit('verify_payment', requestId, startedAt, 'error', `HTTP_${res.status}`, JSON.stringify({ invoice_id: invoiceId }), this.redactForAudit(data), null, invoiceId, health.state);
        return { ...empty, rawResponse };
      }

      await this.record(true);
      await this.audit('verify_payment', requestId, startedAt, 'success', null, JSON.stringify({ invoice_id: invoiceId }), this.redactForAudit(data), null, invoiceId, health.state);
      return {
        // Unknown/undocumented statuses fall through to 'failed' — never paid.
        status: STATUS_MAP[data.status] ?? 'failed',
        amountPaisa: takaStringToPaisa(data.amount),
        verifiedInvoiceId: typeof data.invoice_id === 'string' ? data.invoice_id : null,
        metadata: data.metadata && typeof data.metadata === 'object' ? (data.metadata as Record<string, unknown>) : null,
        transactionId: typeof data.transaction_id === 'string' ? data.transaction_id : null,
        paymentMethod: typeof data.payment_method === 'string' ? data.payment_method : null,
        rawResponse,
      };
    } catch (err) {
      const code = err instanceof DOMException && err.name === 'AbortError' ? 'TIMEOUT' : 'REQUEST_FAILED';
      await this.record(false);
      await this.audit('verify_payment', requestId, startedAt, code === 'TIMEOUT' ? 'timeout' : 'error', code, JSON.stringify({ invoice_id: invoiceId }), JSON.stringify({ error: code }), null, invoiceId, health.state);
      return { ...empty, rawResponse: JSON.stringify({ error: code }) };
    }
  }

  /** PaymentProviderContract: alias for createCheckout */
  async createPayment(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    return this.createCheckout(input);
  }

  /**
   * N-28: UddoktaPay authenticates webhooks with the API key header, not an
   * HMAC signature — confirmed against the provider's validate-webhook docs.
   * The previous implementation demanded a signature that the provider never
   * sends, so every real webhook was rejected.
   *
   * The body is treated purely as a notification: the caller must still call
   * verifyPayment() before trusting anything in it.
   */
  async parseWebhook(request: Request): Promise<unknown> {
    const configured = this.env.UDDOKTAPAY_API_KEY ?? '';
    if (!configured) return null;
    const presented = request.headers.get('RT-UDDOKTAPAY-API-KEY') ?? '';
    if (!timingSafeEqualString(presented, configured)) return null;
    const rawBody = await request.text().catch(() => '');
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();

    if (!this.env.UDDOKTAPAY_API_KEY) {
      return { ok: false, rawResponse: '{"error":"not_configured"}', errorCode: 'NOT_CONFIGURED' };
    }

    const health = await this.checkCircuit();
    if (!health.canProceed) {
      await this.audit('refund_payment', requestId, startedAt, 'circuit_open', 'CIRCUIT_OPEN', JSON.stringify({ transaction_id: input.transactionId }), '{"error":"circuit_open"}', null, null, health.state);
      return { ok: false, rawResponse: '{"error":"circuit_open"}', errorCode: 'CIRCUIT_OPEN' };
    }

    try {
      const res = await this.fetchWithTimeout(`${this.baseUrl()}/api/refund-payment`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          transaction_id: input.transactionId,
          payment_method: input.paymentMethod,
          amount: (input.amountPaisa / 100).toFixed(2),
          product_name: input.productName,
          reason: input.reason,
        }),
      });
      const { data, parsed } = await this.readJson(res);
      const rawResponse = JSON.stringify(data);
      // The provider signals refund success by HTTP status; a body that did
      // not even parse is not a confirmation.
      const ok = res.ok && parsed;
      await this.record(ok);
      await this.audit('refund_payment', requestId, startedAt, ok ? 'success' : 'error', ok ? null : `HTTP_${res.status}`, JSON.stringify({ transaction_id: input.transactionId, amount_paisa: input.amountPaisa }), this.redactForAudit(data), null, null, health.state);
      return ok ? { ok: true, rawResponse } : { ok: false, rawResponse, errorCode: parsed ? `HTTP_${res.status}` : 'BAD_RESPONSE' };
    } catch (err) {
      const code = err instanceof DOMException && err.name === 'AbortError' ? 'TIMEOUT' : 'REQUEST_FAILED';
      await this.record(false);
      await this.audit('refund_payment', requestId, startedAt, code === 'TIMEOUT' ? 'timeout' : 'error', code, JSON.stringify({ transaction_id: input.transactionId, amount_paisa: input.amountPaisa }), JSON.stringify({ error: code }), null, null, health.state);
      return { ok: false, rawResponse: JSON.stringify({ error: code }), errorCode: code };
    }
  }

  private baseUrl(): string {
    return normalizeBaseUrl(this.env.UDDOKTAPAY_BASE_URL);
  }

  private headers(): HeadersInit {
    return {
      'RT-UDDOKTAPAY-API-KEY': this.env.UDDOKTAPAY_API_KEY ?? '',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  private async checkCircuit(): Promise<{ canProceed: boolean; state: 'closed' | 'open' | 'half_open' }> {
    if (!this.env.PROVIDER_HEALTH_DO) return { canProceed: true, state: 'closed' };
    return doCheckProviderHealth(this.env, 'uddoktapay');
  }

  private async record(success: boolean): Promise<void> {
    if (!this.env.PROVIDER_HEALTH_DO) return;
    await doRecordProviderResult(this.env, 'uddoktapay', success);
  }

  private async audit(operation: string, requestId: string, startedAt: number, status: 'success' | 'error' | 'timeout' | 'circuit_open', errorCode: string | null, requestSummary: string, responseSummary: string, orderId: string | null, invoiceId: string | null, circuitState: 'closed' | 'open' | 'half_open'): Promise<void> {
    await writeApiAuditLog(this.env.DB, {
      provider: 'uddoktapay',
      operation,
      requestId,
      orderId,
      invoiceId,
      durationMs: Date.now() - startedAt,
      status,
      errorCode,
      circuitState,
      redactedRequestSummary: requestSummary,
      redactedResponseSummary: responseSummary,
    });
  }
}
