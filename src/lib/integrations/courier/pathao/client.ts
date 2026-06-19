import type { CourierEnv, CreateShipmentInput, CreateShipmentResult, TrackingResult, CancelShipmentResult, CourierProviderInterface } from '../types';
import { writeApiAuditLog } from '../../../api-audit';
import { doCheckProviderHealth, doRecordProviderResult } from '../../../do-client';

export class PathaoClient implements CourierProviderInterface {
  constructor(private readonly env: CourierEnv) {}

  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    return this.call('create_shipment', async () => {
      const res = await fetch(`${this.baseUrl}/aladdin/api/v1/orders`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          store_id: this.env.PATHAO_CLIENT_ID,
          merchant_order_id: input.orderId,
          recipient_name: input.recipientName,
          recipient_phone: input.recipientPhone,
          recipient_address: input.recipientAddress,
          recipient_city: input.recipientCity,
          recipient_zone: input.recipientZone,
          cod_amount: input.codAmountPaisa / 100,
          item_weight: input.weight,
          item_quantity: input.itemCount,
          special_instruction: input.specialNote,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (!res.ok || !data) return { ok: false, rawResponse: JSON.stringify(data), errorCode: `HTTP_${res.status}` };
      return { ok: true, trackingNumber: data?.consignment_id as string | undefined, rawResponse: JSON.stringify(data) };
    });
  }

  async trackShipment(trackingNumber: string): Promise<TrackingResult> {
    return this.call('track_shipment', async () => {
      const res = await fetch(`${this.baseUrl}/aladdin/api/v1/consignment/${trackingNumber}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (!res.ok || !data) return { ok: false, status: 'unknown', events: [], rawResponse: JSON.stringify(data), errorCode: `HTTP_${res.status}` };
      return { ok: true, status: (data?.order_status as string) ?? 'unknown', events: [], rawResponse: JSON.stringify(data) };
    });
  }

  async cancelShipment(trackingNumber: string): Promise<CancelShipmentResult> {
    return this.call('cancel_shipment', async () => {
      const res = await fetch(`${this.baseUrl}/aladdin/api/v1/consignment/${trackingNumber}/cancel`, {
        method: 'POST',
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      });
      const rawResponse = await res.text().catch(() => '');
      return { ok: res.ok, rawResponse, errorCode: res.ok ? undefined : `HTTP_${res.status}` };
    });
  }

  private get baseUrl() { return this.env.PATHAO_BASE_URL ?? 'https://api-hermes.pathao.com'; }
  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.env.PATHAO_CLIENT_SECRET ?? ''}` };
  }
  private async call<T extends { ok: boolean; rawResponse: string; errorCode?: string }>(
    operation: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const health = this.env.PROVIDER_HEALTH_DO ? await doCheckProviderHealth(this.env, 'pathao') : { canProceed: true, state: 'closed' as const };
    if (!health.canProceed) {
      const result = { ok: false, rawResponse: '{"error":"circuit_open"}', errorCode: 'CIRCUIT_OPEN' } as T;
      await writeApiAuditLog(this.env.DB, { provider: 'pathao', operation, requestId, durationMs: Date.now() - startedAt, status: 'circuit_open', errorCode: 'CIRCUIT_OPEN', circuitState: health.state });
      return result;
    }
    try {
      const result = await fn();
      await doRecordProviderResult(this.env, 'pathao', result.ok).catch(() => {});
      await writeApiAuditLog(this.env.DB, { provider: 'pathao', operation, requestId, durationMs: Date.now() - startedAt, status: result.ok ? 'success' : 'error', errorCode: result.errorCode, circuitState: health.state, redactedResponseSummary: result.rawResponse.slice(0, 200) });
      return result;
    } catch (err) {
      const code = err instanceof DOMException && err.name === 'AbortError' ? 'TIMEOUT' : 'REQUEST_FAILED';
      await doRecordProviderResult(this.env, 'pathao', false).catch(() => {});
      await writeApiAuditLog(this.env.DB, { provider: 'pathao', operation, requestId, durationMs: Date.now() - startedAt, status: code === 'TIMEOUT' ? 'timeout' : 'error', errorCode: code, circuitState: health.state });
      return { ok: false, rawResponse: `{"error":"${code}"}`, errorCode: code } as T;
    }
  }
}
