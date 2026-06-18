import type { WorkersAITextResult } from './types';

export class WorkersAIClient {
  constructor(private readonly ai?: Ai) {}

  async generateProductDescription(prompt: string): Promise<WorkersAITextResult> {
    if (!this.ai) {
      return { text: JSON.stringify({ description: prompt.slice(0, 240), metaTitle: 'Product draft', metaDescription: 'Product draft generated locally.' }), tokens_used: 0, cost_usd: 0 };
    }
    const result = await this.ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
    }) as { response?: string };
    return { text: result.response ?? '', tokens_used: 0, cost_usd: 0 };
  }
}
