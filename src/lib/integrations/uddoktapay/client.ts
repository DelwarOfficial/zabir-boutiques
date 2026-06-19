import { writeApiAuditLog } from '../../api-audit';
import { doCheckProviderHealth, doRecordProviderResult } from '../../do-client';
import type { PaymentStatus, VerifiedPayment } from '../../payments';
import type { CreateCheckoutInput, CreateCheckoutResult, RefundPaymentInput, RefundPaymentResult, UddoktaPayEnv } from './types';

function takaStringToPaisa(amount: unknown): number | null {
  if (typeof amount !== 'string' && typeof amount !== 'number') return null;
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

const STATUS_MAP: Record<string, PaymentStatus> = {
  COMPLETED: 'paid',
  PENDING: 'pending',
  PROCESSING: 'processing',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
};

export class UddoktaPayClient {
  constructor(private readonly env: UddoktaPayEnv) {}

  private summarizeCheckoutResponse(data: { payment_url?: string }): string {
    return JSON.stringify({ payment_url: typeof data.payment_url === 'string' ? '[redacted]' : null });
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const health = await this.checkCircuit();
    if (!health.canProceed) {
      await this.audit('checkout', requestId, startedAt, 'circuit_open', 'CIRCUIT_OPEN', JSON.stringify({ invoice_id: input.invoiceId, order_id: input.orderId }), '{"error":"circuit_open"}', input.orderId, input.invoiceId, health.state);
      return { ok: false, rawResponse: '{"error":"circuit_open"}', errorCode: 'CIRCUIT_OPEN' };
    }

    try {
      const res = await fetch(`${this.baseUrl()}/api/checkout`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          invoice_id: input.invoiceId,
          amount: (input.amountPaisa / 100).toFixed(2),
          currency: 'BDT',
          customer_name: input.customerName,
          customer_phone: input.customerPhone,
          metadata: { order_id: input.orderId, type: input.type },
          redirect_url: input.redirectUrl,
          cancel_url: input.cancelUrl,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { payment_url?: string };
      const rawResponse = JSON.stringify(data);
      const auditResponse = this.summarizeCheckoutResponse(data);
      const ok = res.ok && typeof data.payment_url === 'string' && data.payment_url.length > 0;
      await this.record(ok);
      await this.audit('checkout', requestId, startedAt, ok ? 'success' : 'error', ok ? null : `HTTP_${res.status}`, JSON.stringify({ invoice_id: input.invoiceId, order_id: input.orderId }), auditResponse, input.orderId, input.invoiceId, health.state);
      return ok ? { ok: true, paymentUrl: data.payment_url, rawResponse } : { ok: false, rawResponse, errorCode: `HTTP_${res.status}` };
    } catch (err) {
      const code = err instanceof DOMException && err.name === 'AbortError' ? 'TIMEOUT' : 'REQUEST_FAILED';
      await this.record(false);
      await this.audit('checkout', requestId, startedAt, code === 'TIMEOUT' ? 'timeout' : 'error', code, JSON.stringify({ invoice_id: input.invoiceId, order_id: input.orderId }), JSON.stringify({ error: code }), input.orderId, input.invoiceId, health.state);
      return { ok: false, rawResponse: JSON.stringify({ error: code }), errorCode: code };
    }
  }

  async verifyPayment(invoiceId: string): Promise<VerifiedPayment> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const health = await this.checkCircuit();
    if (!health.canProceed) {
      await this.audit('verify_payment', requestId, startedAt, 'circuit_open', 'CIRCUIT_OPEN', JSON.stringify({ invoice_id: invoiceId }), '{"error":"circuit_open"}', null, invoiceId, health.state);
      return { status: 'failed', amountPaisa: null, verifiedInvoiceId: null, metadata: null, rawResponse: '{"error":"circuit_open"}' };
    }

    const empty: VerifiedPayment = { status: 'failed', amountPaisa: null, verifiedInvoiceId: null, metadata: null, rawResponse: '' };
    try {
      const res = await fetch(`${this.baseUrl()}/api/verify-payment`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ invoice_id: invoiceId }),
      });
      const data = (await res.json().catch(() => ({}))) as { status?: string; amount?: string | number; invoice_id?: string; metadata?: Record<string, unknown> };
      const rawResponse = JSON.stringify(data);
      if (!res.ok || !data.status) {
        await this.record(false);
        await this.audit('verify_payment', requestId, startedAt, 'error', `HTTP_${res.status}`, JSON.stringify({ invoice_id: invoiceId }), rawResponse, null, invoiceId, health.state);
        return { ...empty, rawResponse };
      }
      await this.record(true);
      await this.audit('verify_payment', requestId, startedAt, 'success', null, JSON.stringify({ invoice_id: invoiceId }), rawResponse, null, invoiceId, health.state);
      return {
        status: STATUS_MAP[data.status] ?? 'failed',
        amountPaisa: takaStringToPaisa(data.amount),
        verifiedInvoiceId: typeof data.invoice_id === 'string' ? data.invoice_id : null,
        metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : null,
        rawResponse,
      };
    } catch (err) {
      const code = err instanceof DOMException && err.name === 'AbortError' ? 'TIMEOUT' : 'REQUEST_FAILED';
      await this.record(false);
      await this.audit('verify_payment', requestId, startedAt, code === 'TIMEOUT' ? 'timeout' : 'error', code, JSON.stringify({ invoice_id: invoiceId }), JSON.stringify({ error: code }), null, invoiceId, health.state);
      return { ...empty, rawResponse: JSON.stringify({ error: code }) };
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const health = await this.checkCircuit();
    if (!health.canProceed) {
      await this.audit('refund_payment', requestId, startedAt, 'circuit_open', 'CIRCUIT_OPEN', JSON.stringify({ invoice_id: input.invoiceId }), '{"error":"circuit_open"}', null, input.invoiceId, health.state);
      return { ok: false, rawResponse: '{"error":"circuit_open"}', errorCode: 'CIRCUIT_OPEN' };
    }

    try {
      const res = await fetch(`${this.baseUrl()}/api/refund-payment`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          invoice_id: input.invoiceId,
          amount: (input.amountPaisa / 100).toFixed(2),
          reason: input.reason,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const rawResponse = JSON.stringify(data);
      await this.record(res.ok);
      await this.audit('refund_payment', requestId, startedAt, res.ok ? 'success' : 'error', res.ok ? null : `HTTP_${res.status}`, JSON.stringify({ invoice_id: input.invoiceId, amount_paisa: input.amountPaisa }), rawResponse, null, input.invoiceId, health.state);
      return res.ok ? { ok: true, rawResponse } : { ok: false, rawResponse, errorCode: `HTTP_${res.status}` };
    } catch (err) {
      const code = err instanceof DOMException && err.name === 'AbortError' ? 'TIMEOUT' : 'REQUEST_FAILED';
      await this.record(false);
      await this.audit('refund_payment', requestId, startedAt, code === 'TIMEOUT' ? 'timeout' : 'error', code, JSON.stringify({ invoice_id: input.invoiceId, amount_paisa: input.amountPaisa }), JSON.stringify({ error: code }), null, input.invoiceId, health.state);
      return { ok: false, rawResponse: JSON.stringify({ error: code }), errorCode: code };
    }
  }

  private baseUrl(): string {
    return this.env.UDDOKTAPAY_BASE_URL ?? 'https://payment.uddoktapay.com';
  }

  private headers(): HeadersInit {
    return {
      'RT-UDDOKTAPAY-API-KEY': this.env.UDDOKTAPAY_API_KEY ?? '',
      accept: 'application/json',
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
