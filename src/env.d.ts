/// <reference types="astro/client" />

/**
 * D1 type augmentation [v6.8D]
 *
 * The installed @cloudflare/workers-types package does not yet include the
 * `D1Database.batch(stmts, { atomic: true })` overload even though the
 * Cloudflare D1 runtime supports it. We augment the type here so the
 * compile-time signature matches the runtime behaviour.
 */
declare global {
  interface D1BatchOptions {
    atomic?: boolean;
    batchSize?: number;
  }
  interface D1Database {
    batch<T = unknown>(statements: D1PreparedStatement[], options?: D1BatchOptions): Promise<D1Result<T>[]>;
  }
}

export type Env = {
  DB: D1Database;
  CACHE: KVNamespace;
  SESSION: KVNamespace;
  MEDIA: R2Bucket;
  BACKUPS: R2Bucket;
  TINIFY_API_KEY: string;
  UDDOKTAPAY_API_KEY: string;
  UDDOKTAPAY_BASE_URL: string;
  FRAUDBD_API_KEY: string;
  DEEPSEEK_API_KEY: string;
  OPENAI_API_KEY: string;
  SESSION_SECRET: string;
  API_KEY_PEPPER: string;
  AUDIT_LEDGER_SECRET: string;
  PASSWORD_PEPPER: string;
  PUBLIC_SITE_URL: string;
  PUBLIC_SITE_NAME: string;
};

declare global {
  namespace App {
    interface Locals {
      /** Set by middleware after resolving the staff session (defense-in-depth auth guard). */
      staffUser?: import('./lib/rbac').StaffUser | null;
      /** True once middleware has attempted to resolve the staff session for this request. */
      staffUserResolved?: boolean;
    }
  }
}
