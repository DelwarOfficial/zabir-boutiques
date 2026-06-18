export interface TinifyEnv {
  DB?: D1Database;
  PROVIDER_HEALTH_DO?: DurableObjectNamespace;
}

export type TinifyProcessResult = { ok: true; data: ArrayBuffer; contentType: string } | { ok: false; error: string };
