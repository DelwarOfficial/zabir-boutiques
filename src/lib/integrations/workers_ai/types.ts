export interface WorkersAITextResult {
  text: string;
  tokens_used: number;
  cost_usd: number;
}

export interface WorkersAIEnv {
  AI?: Ai;
  DB?: D1Database;
  PROVIDER_HEALTH_DO?: DurableObjectNamespace;
}
