import type { ProviderHealthDOContract } from '../lib/contracts/provider-health-do';
import { writeApiAuditLog } from '../lib/api-audit';

/**
 * ProviderHealthDO [Master_Prompt v7.0 §6.6]
 *
 * Circuit breaker for external API providers (FraudBD, UddoktaPay, DeepSeek, Imagify, email, courier).
 * Each provider has a Durable Object keyed by provider:{name}.
 *
 * States:
 *   closed  — normal operation, requests pass through
 *   open    — provider is failing, requests are short-circuited
 *   half-open — testing if provider has recovered
 */

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface ProviderHealth {
  provider: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  openedAt: string | null;
  halfOpenAt: string | null;
  failureTimestamps: number[];
  failureThreshold: number;
  recoveryTimeMs: number;
  halfOpenMaxAttempts: number;
  probeInFlight?: boolean;
}

export class ProviderHealthDO implements DurableObject, ProviderHealthDOContract {
  private state: DurableObjectState;
  private env: { DB?: D1Database };
  private health: ProviderHealth | null = null;

  constructor(state: DurableObjectState, env: { DB?: D1Database }) {
    this.state = state;
    this.env = env;
  }

  private async ensureLoaded(provider: string): Promise<ProviderHealth> {
    if (this.health) return this.health;
    const stored = await this.state.storage.get<ProviderHealth>('health');
    this.health = stored ?? {
      provider,
      state: 'closed',
      failureCount: 0,
      successCount: 0,
      lastFailureAt: null,
      lastSuccessAt: null,
      openedAt: null,
      halfOpenAt: null,
      failureTimestamps: [],
      failureThreshold: 5,
      recoveryTimeMs: 5 * 60 * 1000,
      halfOpenMaxAttempts: 1,
      probeInFlight: false,
    };
    return this.health;
  }

  private async persist(): Promise<void> {
    if (!this.health) return;
    await this.state.storage.put('health', this.health);
  }

  private async auditTransition(provider: string, circuitState: CircuitState, status: 'success' | 'error', errorCode: string | null = null): Promise<void> {
    await writeApiAuditLog(this.env.DB, {
      provider,
      operation: 'circuit_transition',
      requestId: crypto.randomUUID(),
      status,
      errorCode,
      circuitState,
      redactedRequestSummary: JSON.stringify({ provider }),
      redactedResponseSummary: JSON.stringify({ state: circuitState }),
    });
  }

  async checkCircuit(input: { provider: string }): Promise<{ state: CircuitState; open_until?: string }> {
    const health = await this.ensureLoaded(input.provider);
    return { state: health.state, open_until: health.openedAt ?? undefined };
  }

  async recordResult(input: { provider: string; success: boolean; duration_ms: number; error_code?: string }): Promise<{ new_state: CircuitState; open_until?: string }> {
    const res = await this.fetch(new Request('https://do/record', { method: 'POST', body: JSON.stringify({ provider: input.provider, success: input.success }) }));
    const data = await res.json() as { state: CircuitState; health?: ProviderHealth };
    return { new_state: data.state, open_until: data.health?.openedAt ?? undefined };
  }

  async getState(input: { provider: string }): Promise<unknown> {
    return this.fetch(new Request('https://do/status', { method: 'POST', body: JSON.stringify({ provider: input.provider }) })).then((r) => r.json());
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.slice(1) || 'status';
    const body = (await request.json().catch(() => ({}))) as {
      provider?: string;
      success?: boolean;
    };

    const provider = body.provider ?? url.searchParams.get('provider') ?? 'unknown';
    const health = await this.ensureLoaded(provider);

    switch (action) {
      case 'status': {
        // Check if we should transition from open to half-open
        if (health.state === 'open' && health.openedAt) {
          const openedAt = new Date(health.openedAt).getTime();
          if (Date.now() - openedAt > health.recoveryTimeMs) {
            health.state = 'half_open';
            health.halfOpenAt = new Date().toISOString();
            health.successCount = 0;
            health.probeInFlight = false;
            await this.persist();
            await this.auditTransition(provider, 'half_open', 'success');
          }
        }

        const canProceed = health.state === 'open'
          ? false
          : health.state === 'half_open'
            ? health.probeInFlight !== true
            : true;
        if (health.state === 'half_open' && health.probeInFlight !== true) {
          health.probeInFlight = true;
          await this.persist();
        }

        return Response.json({
          ok: true,
          state: health.state,
          canProceed,
          health,
        });
      }

      case 'record': {
        const success = body.success ?? false;
        const now = new Date().toISOString();

        if (success) {
          health.successCount++;
          health.lastSuccessAt = now;

          if (health.state === 'half_open') {
            if (health.successCount >= health.halfOpenMaxAttempts) {
              health.state = 'closed';
              health.failureCount = 0;
              health.failureTimestamps = [];
              health.openedAt = null;
              health.halfOpenAt = null;
              health.probeInFlight = false;
              await this.auditTransition(provider, 'closed', 'success');
            }
          } else if (health.state === 'closed') {
            health.failureCount = Math.max(0, health.failureCount - 1);
          }
        } else {
          health.failureCount++;
          health.lastFailureAt = now;
          const failureAt = Date.now();
          const windowStart = failureAt - 60 * 1000;
          health.failureTimestamps = [...(health.failureTimestamps ?? []), failureAt].filter(ts => ts >= windowStart);

          if (health.state === 'half_open') {
            health.state = 'open';
            health.openedAt = now;
            health.halfOpenAt = null;
            health.successCount = 0;
            health.probeInFlight = false;
            await this.auditTransition(provider, 'open', 'error', 'HALF_OPEN_FAILURE');
          } else if (health.state === 'closed') {
            if (health.failureTimestamps.length >= health.failureThreshold) {
              health.state = 'open';
              health.openedAt = now;
              await this.auditTransition(provider, 'open', 'error', 'FAILURE_THRESHOLD_REACHED');
            }
          }
        }

        await this.persist();
        return Response.json({ ok: true, state: health.state, health });
      }

      case 'reset': {
        health.state = 'closed';
        health.failureCount = 0;
        health.failureTimestamps = [];
        health.successCount = 0;
        health.openedAt = null;
        health.halfOpenAt = null;
        await this.persist();
        return Response.json({ ok: true, state: health.state, health });
      }

      default:
        return Response.json({ ok: false, error: 'UNKNOWN_ACTION' }, { status: 400 });
    }
  }
}
