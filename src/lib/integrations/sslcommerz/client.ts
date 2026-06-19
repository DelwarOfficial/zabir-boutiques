import { writeApiAuditLog } from '../../api-audit';
import { doCheckProviderHealth, doRecordProviderResult } from '../../do-client';
import { takaStringToPaisa, type VerifiedPayment } from '../../payments';
import type { CreateCheckoutInput, CreateCheckoutResult, SSLCommerzEnv } from './types';

const STATUS_MAP: Record<string, VerifiedPayment['status']> = {
  VALID: 'paid',
  VALIDATED: 'paid',
  PENDING: 'pending',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

export class SSLCommerzClient {
  constructor(private readonly env: SSLCommerzEnv) {}

  private configured(): boolean {
    return Boolean(this.env.SSLCOMMERZ_STORE_ID && this.env.SSLCOMMERZ_STORE_PASSWORD);
  }

  private baseUrl(): string {
    return this.env.SSLCOMMERZ_BASE_URL ?? 'https://sandbox.sslcommerz.com';
  }

  private storeId(): string {
    return this.env.SSLCOMMERZ_STORE_ID ?? '';
  }

  private storePassword(): string {
    return this.env.SSLCOMMERZ_STORE_PASSWORD ?? '';
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    if (!this.configured()) {
      return { ok: false, rawResponse: '{"error":"not_configured"}', errorCode: 'NOT_CONFIGURED' };
    }

    const health = await this.checkCircuit();
    if (!health.canProceed) {
      await this.audit('create_payment', requestId, startedAt, 'circuit_open', 'CIRCUIT_OPEN', JSON.stringify({ tran_id: input.invoiceId }), '{"error":"circuit_open"}', input.orderId, input.invoiceId, health.state);
      return { ok: false, rawResponse: '{"error":"circuit_open"}', errorCode: 'CIRCUIT_OPEN' };
    }

    try {
      const body = new URLSearchParams({
        store_id: this.storeId(),
        store_passwd: this.storePassword(),
        total_amount: (input.amountPaisa / 100).toFixed(2),
        currency: 'BDT',
        tran_id: input.invoiceId,
        success_url: input.redirectUrl,
        fail_url: input.cancelUrl,
        cancel_url: input.cancelUrl,
        cus_name: input.customerName || 'Customer',
        cus_phone: input.customerPhone || '01700000000',
        product_name: `Order ${input.orderId}`,
        product_category: 'boutique',
        product_profile: 'general',
        shipping_method: 'NO',
        num_of_item: '1',
        emi_option: '0',
        value_a: input.orderId,
        value_b: input.type,
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(`${this.baseUrl()}/gwprocess/v4/api.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = (await res.json().catch(() => ({}))) as { status?: string; GatewayPageURL?: string; failedreason?: string };
      const rawResponse = JSON.stringify(data);
      const ok = res.ok && data.status === 'SUCCESS' && typeof data.GatewayPageURL === 'string' && data.GatewayPageURL.length > 0;
      await this.record(ok);
      await this.audit('create_payment', requestId, startedAt, ok ? 'success' : 'error', ok ? null : `HTTP_${res.status}`, JSON.stringify({ tran_id: input.invoiceId }), rawResponse, input.orderId, input.invoiceId, health.state);
      return ok
        ? { ok: true, paymentUrl: data.GatewayPageURL, rawResponse }
        : { ok: false, rawResponse, errorCode: data.failedreason ?? `HTTP_${res.status}` };
    } catch (err) {
      const code = err instanceof DOMException && err.name === 'AbortError' ? 'TIMEOUT' : 'REQUEST_FAILED';
      await this.record(false);
      await this.audit('create_payment', requestId, startedAt, code === 'TIMEOUT' ? 'timeout' : 'error', code, JSON.stringify({ tran_id: input.invoiceId }), JSON.stringify({ error: code }), input.orderId, input.invoiceId, health.state);
      return { ok: false, rawResponse: JSON.stringify({ error: code }), errorCode: code };
    }
  }

  async verifyPayment(invoiceId: string): Promise<VerifiedPayment> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const empty: VerifiedPayment = { status: 'failed', amountPaisa: null, verifiedInvoiceId: null, metadata: null, rawResponse: '' };
    if (!this.configured()) return { ...empty, rawResponse: '{"error":"not_configured"}' };

    const health = await this.checkCircuit();
    if (!health.canProceed) {
      await this.audit('verify_payment', requestId, startedAt, 'circuit_open', 'CIRCUIT_OPEN', JSON.stringify({ tran_id: invoiceId }), '{"error":"circuit_open"}', null, invoiceId, health.state);
      return { ...empty, rawResponse: '{"error":"circuit_open"}' };
    }

    try {
      const url = new URL(`${this.baseUrl()}/validator/api/merchantTransIDvalidationAPI.php`);
      url.searchParams.set('tran_id', invoiceId);
      url.searchParams.set('store_id', this.storeId());
      url.searchParams.set('store_passwd', this.storePassword());
      url.searchParams.set('format', 'json');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(url.toString(), { method: 'GET', signal: controller.signal });
      clearTimeout(timeout);

      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        amount?: string | number;
        tran_id?: string;
        value_a?: string;
        value_b?: string;
      };
      const rawResponse = JSON.stringify(data);
      const statusKey = String(data.status ?? '').toUpperCase();
      const mapped = STATUS_MAP[statusKey] ?? 'failed';
      const amountPaisa = takaStringToPaisa(data.amount);
      const ok = res.ok && mapped === 'paid';
      await this.record(ok);
      await this.audit('verify_payment', requestId, startedAt, ok ? 'success' : 'error', ok ? null : statusKey || `HTTP_${res.status}`, JSON.stringify({ tran_id: invoiceId }), rawResponse, data.value_a ?? null, invoiceId, health.state);
      return {
        status: mapped,
        amountPaisa,
        verifiedInvoiceId: typeof data.tran_id === 'string' ? data.tran_id : invoiceId,
        metadata: data.value_a ? { order_id: data.value_a, type: data.value_b } : null,
        rawResponse,
      };
    } catch (err) {
      const code = err instanceof DOMException && err.name === 'AbortError' ? 'TIMEOUT' : 'REQUEST_FAILED';
      await this.record(false);
      await this.audit('verify_payment', requestId, startedAt, code === 'TIMEOUT' ? 'timeout' : 'error', code, JSON.stringify({ tran_id: invoiceId }), JSON.stringify({ error: code }), null, invoiceId, health.state);
      return { ...empty, rawResponse: JSON.stringify({ error: code }) };
    }
  }

  private async checkCircuit() {
    return doCheckProviderHealth(this.env, 'sslcommerz');
  }

  private async record(success: boolean) {
    await doRecordProviderResult(this.env, 'sslcommerz', success);
  }

  private async audit(
    operation: string,
    requestId: string,
    startedAt: number,
    status: 'success' | 'error' | 'timeout' | 'circuit_open',
    errorCode: string | null,
    requestSummary: string,
    responseSummary: string,
    orderId: string | null,
    invoiceId: string | null,
    circuitState?: string,
  ) {
    if (!this.env.DB) return;
    await writeApiAuditLog(this.env.DB, {
      provider: 'sslcommerz',
      operation,
      requestId,
      orderId,
      invoiceId,
      durationMs: Date.now() - startedAt,
      status,
      errorCode,
      circuitState: (circuitState as 'closed' | 'open' | 'half_open' | null) ?? null,
      redactedRequestSummary: requestSummary,
      redactedResponseSummary: responseSummary,
    });
  }
}