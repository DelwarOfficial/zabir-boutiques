export interface CloudflareCacheEnv {
  CF_API_TOKEN?: string;
  CF_ZONE_ID?: string;
  DB?: D1Database;
  PROVIDER_HEALTH_DO?: DurableObjectNamespace;
}
