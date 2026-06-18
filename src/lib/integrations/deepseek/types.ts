export interface DeepSeekEnv {
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL?: string;
}

export interface DeepSeekTextResult {
  text: string;
  tokens_used: number;
  cost_usd: number;
}
