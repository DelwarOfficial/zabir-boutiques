import { writeApiAuditLog } from '../../api-audit';
import { doCheckProviderHealth, doRecordProviderResult } from '../../do-client';
import type { CompressResult, ConvertTarget, ResizeOptions } from '../../tinify';
import type { TinifyEnv, TinifyProcessResult } from './types';

function basicAuth(apiKey: string): string {
  return `Basic ${btoa(`api:${apiKey}`)}`;
}

export class TinifyClient {
  constructor(private readonly env: TinifyEnv = {}) {}

  async compressImage(imageBuffer: ArrayBuffer, apiKey: string): Promise<CompressResult> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const health = await this.checkCircuit();
    if (!health.canProceed) {
      await this.audit('compress_image', requestId, startedAt, 'circuit_open', 'CIRCUIT_OPEN', JSON.stringify({ bytes: imageBuffer.byteLength }), '{"error":"circuit_open"}', health.state);
      return { ok: false, error: 'Tinify circuit open' };
    }
    const inputSize = imageBuffer.byteLength;
    try {
      const res = await fetch('https://api.tinify.com/shrink', {
        method: 'POST',
        headers: { Authorization: basicAuth(apiKey), 'Content-Type': 'application/octet-stream' },
        body: imageBuffer,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        await this.record(false);
        await this.audit('compress_image', requestId, startedAt, 'error', `HTTP_${res.status}`, JSON.stringify({ bytes: imageBuffer.byteLength }), JSON.stringify(body), health.state);
        return { ok: false, error: `Tinify HTTP ${res.status}: ${String(body.message ?? res.statusText)}` };
      }
      const locationUrl = res.headers.get('Location');
      if (!locationUrl) {
        await this.record(false);
        await this.audit('compress_image', requestId, startedAt, 'error', 'MISSING_LOCATION', JSON.stringify({ bytes: imageBuffer.byteLength }), '{}', health.state);
        return { ok: false, error: 'No Location header from Tinify' };
      }
      const data = (await res.json()) as { input?: { size?: number }; output?: { size?: number; type?: string } };
      await this.record(true);
      await this.audit('compress_image', requestId, startedAt, 'success', null, JSON.stringify({ bytes: imageBuffer.byteLength }), JSON.stringify({ output_size: data.output?.size, type: data.output?.type }), health.state);
      return {
        ok: true,
        compressed: imageBuffer,
        locationUrl,
        inputSize: data.input?.size ?? inputSize,
        outputSize: data.output?.size ?? inputSize,
        contentType: data.output?.type ?? 'application/octet-stream',
      };
    } catch (err) {
      const code = err instanceof Error ? err.message : 'Unknown Tinify error';
      await this.record(false);
      await this.audit('compress_image', requestId, startedAt, 'error', 'REQUEST_FAILED', JSON.stringify({ bytes: imageBuffer.byteLength }), JSON.stringify({ error: code }), health.state);
      return { ok: false, error: code };
    }
  }

  async downloadCompressed(locationUrl: string, apiKey: string): Promise<CompressResult> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    try {
      const res = await fetch(locationUrl, { headers: { Authorization: basicAuth(apiKey) } });
      if (!res.ok) {
        await this.audit('download_compressed', requestId, startedAt, 'error', `HTTP_${res.status}`, JSON.stringify({ location_url: '[redacted]' }), '{}', 'closed');
        return { ok: false, error: `Tinify download HTTP ${res.status}` };
      }
      const compressed = await res.arrayBuffer();
      await this.audit('download_compressed', requestId, startedAt, 'success', null, JSON.stringify({ location_url: '[redacted]' }), JSON.stringify({ bytes: compressed.byteLength }), 'closed');
      return {
        ok: true,
        compressed,
        locationUrl,
        inputSize: 0,
        outputSize: compressed.byteLength,
        contentType: res.headers.get('Content-Type') ?? 'application/octet-stream',
      };
    } catch (err) {
      await this.audit('download_compressed', requestId, startedAt, 'error', 'REQUEST_FAILED', JSON.stringify({ location_url: '[redacted]' }), JSON.stringify({ error: err instanceof Error ? err.message : 'unknown' }), 'closed');
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown Tinify download error' };
    }
  }

  async processImage(locationUrl: string, apiKey: string, options: { resize?: ResizeOptions; convert?: ConvertTarget | ConvertTarget[] | '*/*' } = {}): Promise<TinifyProcessResult> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const body: Record<string, unknown> = {};
    if (options.resize) body.resize = options.resize;
    if (options.convert) body.convert = { type: options.convert };
    try {
      const res = await fetch(locationUrl, {
        method: 'POST',
        headers: { Authorization: basicAuth(apiKey), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        await this.audit('process_image', requestId, startedAt, 'error', `HTTP_${res.status}`, JSON.stringify({ location_url: '[redacted]' }), '{}', 'closed');
        return { ok: false, error: `Tinify process HTTP ${res.status}` };
      }
      const data = await res.arrayBuffer();
      await this.audit('process_image', requestId, startedAt, 'success', null, JSON.stringify({ location_url: '[redacted]' }), JSON.stringify({ bytes: data.byteLength }), 'closed');
      return { ok: true, data, contentType: res.headers.get('Content-Type') ?? 'image/webp' };
    } catch (err) {
      await this.audit('process_image', requestId, startedAt, 'error', 'REQUEST_FAILED', JSON.stringify({ location_url: '[redacted]' }), JSON.stringify({ error: err instanceof Error ? err.message : 'unknown' }), 'closed');
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown Tinify process error' };
    }
  }

  private async checkCircuit(): Promise<{ canProceed: boolean; state: 'closed' | 'open' | 'half_open' }> {
    if (!this.env.PROVIDER_HEALTH_DO) return { canProceed: true, state: 'closed' };
    return doCheckProviderHealth(this.env, 'tinify');
  }

  private async record(success: boolean): Promise<void> {
    if (!this.env.PROVIDER_HEALTH_DO) return;
    await doRecordProviderResult(this.env, 'tinify', success);
  }

  private async audit(operation: string, requestId: string, startedAt: number, status: 'success' | 'error' | 'timeout' | 'circuit_open', errorCode: string | null, requestSummary: string, responseSummary: string, circuitState: 'closed' | 'open' | 'half_open'): Promise<void> {
    await writeApiAuditLog(this.env.DB, {
      provider: 'tinify',
      operation,
      requestId,
      durationMs: Date.now() - startedAt,
      status,
      errorCode,
      circuitState,
      redactedRequestSummary: requestSummary,
      redactedResponseSummary: responseSummary,
    });
  }
}
