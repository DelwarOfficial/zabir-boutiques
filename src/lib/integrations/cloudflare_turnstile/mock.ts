import type { TurnstileResult } from '../../turnstile';

export class MockCloudflareTurnstileClient {
  async verify(): Promise<TurnstileResult> {
    return { ok: true };
  }
}
