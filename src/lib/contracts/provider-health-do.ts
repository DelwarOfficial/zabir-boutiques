export type CircuitState = 'closed' | 'open' | 'half_open';
export interface ProviderHealthDOContract {
  checkCircuit(input: { provider: string }): Promise<{ state: CircuitState; open_until?: string }>;
  recordResult(input: { provider: string; success: boolean; duration_ms: number; error_code?: string }): Promise<{ new_state: CircuitState; open_until?: string }>;
  getState(input: { provider: string }): Promise<unknown>;
}
