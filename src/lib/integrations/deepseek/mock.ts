import type { DeepSeekTextResult } from './types';

export class MockDeepSeekClient {
  async generateProductDescription(): Promise<DeepSeekTextResult> {
    return { text: '{"description":"Mock description","metaTitle":"Mock title","metaDescription":"Mock meta"}', tokens_used: 1, cost_usd: 0, usage: { promptCacheHitTokens: 0, promptCacheMissTokens: 1, completionTokens: 0, totalTokens: 1 } };
  }
}
