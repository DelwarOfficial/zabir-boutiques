/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

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
  LOGS?: R2Bucket;
  EMAIL_TEMPLATES?: R2Bucket;
  REPORTS?: R2Bucket;
  // Master Plan §2.1 — Workers AI binding [Master_Prompt v7.0 §24.1]
  AI: Ai;
  TINIFY_API_KEY: string;
  IMAGIFY_API_KEY?: string;
  UDDOKTAPAY_API_KEY: string;
  UDDOKTAPAY_BASE_URL: string;
  UDDOKTAPAY_WEBHOOK_SECRET?: string;
  SSLCOMMERZ_STORE_ID?: string;
  SSLCOMMERZ_STORE_PASSWORD?: string;
  SSLCOMMERZ_BASE_URL?: string;
  SSLCOMMERZ_WEBHOOK_SECRET?: string;
  TOTP_CIPHER_KEY?: string;
  FRAUDBD_API_KEY: string;
  DEEPSEEK_API_KEY: string;
  DEEPSEEK_BASE_URL?: string;
  OPENAI_API_KEY: string;
  SESSION_SECRET: string;
  API_KEY_PEPPER: string;
  AUDIT_LEDGER_SECRET: string;
  PASSWORD_PEPPER: string;
  PUBLIC_SITE_URL: string;
  PUBLIC_SITE_NAME: string;
  VAT_RATE_PERCENT?: string;
  // Master Plan §3.4 — Durable Objects (required in deployed Workers)
  VARIANT_INVENTORY_DO: DurableObjectNamespace;
  IDEMPOTENCY_DO: DurableObjectNamespace;
  AI_BUDGET: DurableObjectNamespace;
  WAF_RULES: DurableObjectNamespace;
  CART_DO: DurableObjectNamespace;
  DIRECT_CHECKOUT_DO: DurableObjectNamespace;
  PROVIDER_HEALTH_DO: DurableObjectNamespace;
  // Master Plan §3.5 — Queues (required in deployed Workers)
  PAYMENT_WEBHOOKS: Queue;
  ORDER_EMAILS: Queue;
  IMAGE_PROCESSING: Queue;
  FRAUD_AUDIT: Queue;
  D1_BACKUP: Queue;
  CART_ACTIVITY: Queue;
  // Master Plan §17.2 — Analytics Engine
  ANALYTICS: AnalyticsEngineDataset;
  // Master_Prompt v7.0 §2.6 Turnstile
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  ALLOW_DEV_PHONE_OTP?: string;
  // Master_Prompt v7.0 §2.10 Email
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  EMAIL_PROVIDER?: 'resend' | 'cloudflare_email';
  // POS invoice compliance (Bangladesh NBR SRO 198/Law/2015).
  // Operator-supplied. Production deploy MUST set these via
  // `wrangler secret put`; without them the printed receipt is missing
  // the legal footer.
  POS_BIN?: string; // 15-digit Business Identification Number
  POS_TIN?: string; // 12-digit Taxpayer Identification Number
};

declare global {
  interface Window {
    /** HttpOnly CSRF token injected by StaffLayout (double-submit header value). */
    __ZB_CSRF__?: string;
  }

  namespace App {
    interface Locals {
      /** Set by middleware after resolving the staff session (defense-in-depth auth guard). */
      staffUser?: import('./lib/rbac').StaffUser | null;
      /** True once middleware has attempted to resolve the staff session for this request. */
      staffUserResolved?: boolean;
      /** Per-request CSP nonce (Master_Prompt v7.0 §9.5). */
      cspNonce?: string;
      /** Cloudflare execution context (waitUntil, passThroughOnException). */
      cfContext?: ExecutionContext;
    }
  }
}
