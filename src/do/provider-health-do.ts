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

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface ProviderHealth {
  provider: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  openedAt: string | null;
  halfOpenAt: string | null;
  failureThreshold: number;
  recoveryTimeMs: number;
  halfOpenMaxAttempts: number;
}

export class ProviderHealthDO implements DurableObject {
  private state: DurableObjectState;
  private health: ProviderHealth | null = null;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
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
      failureThreshold: 5,
      recoveryTimeMs: 60000, // 1 minute
      halfOpenMaxAttempts: 3,
    };
    return this.health;
  }

  private async persist(): Promise<void> {
    if (!this.health) return;
    await this.state.storage.put('health', this.health);
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
            health.state = 'half-open';
            health.halfOpenAt = new Date().toISOString();
            health.successCount = 0;
            await this.persist();
          }
        }

        return Response.json({
          ok: true,
          state: health.state,
          canProceed: health.state !== 'open',
          health,
        });
      }

      case 'record': {
        const success = body.success ?? false;
        const now = new Date().toISOString();

        if (success) {
          health.successCount++;
          health.lastSuccessAt = now;

          if (health.state === 'half-open') {
            if (health.successCount >= health.halfOpenMaxAttempts) {
              health.state = 'closed';
              health.failureCount = 0;
              health.openedAt = null;
              health.halfOpenAt = null;
            }
          } else if (health.state === 'closed') {
            health.failureCount = Math.max(0, health.failureCount - 1);
          }
        } else {
          health.failureCount++;
          health.lastFailureAt = now;

          if (health.state === 'half-open') {
            health.state = 'open';
            health.openedAt = now;
            health.halfOpenAt = null;
            health.successCount = 0;
          } else if (health.state === 'closed') {
            if (health.failureCount >= health.failureThreshold) {
              health.state = 'open';
              health.openedAt = now;
            }
          }
        }

        await this.persist();
        return Response.json({ ok: true, state: health.state, health });
      }

      case 'reset': {
        health.state = 'closed';
        health.failureCount = 0;
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
