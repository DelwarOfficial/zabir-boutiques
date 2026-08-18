export interface DeepSeekEnv {
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL?: string;
  DB?: D1Database;
  PROVIDER_HEALTH_DO?: DurableObjectNamespace;
}

export interface DeepSeekTextResult {
  text: string;
  tokens_used: number;
  cost_usd: number;
  /**
   * N-29: token split behind cost_usd. Kept so a budget discrepancy can be
   * traced to a rate that drifted rather than to a counting bug.
   */
  usage: DeepSeekUsage;
}

export interface DeepSeekUsage {
  promptCacheHitTokens: number;
  promptCacheMissTokens: number;
  completionTokens: number;
  totalTokens: number;
}
