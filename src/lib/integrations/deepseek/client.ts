import { DeepSeekError } from './errors';
import type { DeepSeekEnv, DeepSeekTextResult } from './types';

export class DeepSeekClient {
  constructor(private readonly env: DeepSeekEnv) {}

  async generateProductDescription(prompt: string): Promise<DeepSeekTextResult> {
    if (!this.env.DEEPSEEK_API_KEY) throw new DeepSeekError('DeepSeek API key not configured', 'NO_DEEPSEEK_API_KEY');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`${this.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 1000,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new DeepSeekError(`DeepSeek API error: ${res.status}`, `HTTP_${res.status}`);
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { total_tokens?: number } };
      const text = data.choices?.[0]?.message?.content ?? '';
      if (!text) throw new DeepSeekError('DeepSeek returned empty content', 'EMPTY_RESPONSE');
      const tokens = data.usage?.total_tokens ?? 0;
      return { text, tokens_used: tokens, cost_usd: tokens * 0.000002 };
    } finally {
      clearTimeout(timer);
    }
  }
}
