export interface BudgetCounterDOContract {
  recordUsage(input: { provider: 'workers_ai' | 'deepseek' | 'imagify'; tokens: number; cost_usd: number; request_id: string; staff_id: string; operation: string }): Promise<{ recorded: boolean; new_daily_total_usd: number; new_monthly_total_usd: number; soft_alert_triggered: boolean; hard_block_reached: boolean }>;
  canUseDeepSeek(): Promise<boolean>;
  canUseWorkersAI(): Promise<boolean>;
  canUseImagify(): Promise<boolean>;
}
