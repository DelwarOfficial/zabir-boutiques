export interface FraudBDEnv {
  FRAUDBD_API_KEY?: string;
  DB?: D1Database;
  PROVIDER_HEALTH_DO?: DurableObjectNamespace;
}

export interface FraudBDResult {
  data: unknown;
  rawResponse: string;
  circuitOpen: boolean;
}
