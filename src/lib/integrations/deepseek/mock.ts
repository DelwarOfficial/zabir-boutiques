import type { DeepSeekTextResult } from './types';

export class MockDeepSeekClient {
  async generateProductDescription(): Promise<DeepSeekTextResult> {
    return { text: '{"description":"Mock description","metaTitle":"Mock title","metaDescription":"Mock meta"}', tokens_used: 1, cost_usd: 0 };
  }
}
