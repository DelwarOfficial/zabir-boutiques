import type { WorkersAITextResult } from './types';

export class MockWorkersAIClient {
  async generateProductDescription(): Promise<WorkersAITextResult> {
    return { text: '{"description":"Fallback description","metaTitle":"Fallback title","metaDescription":"Fallback meta"}', tokens_used: 1, cost_usd: 0 };
  }
}
