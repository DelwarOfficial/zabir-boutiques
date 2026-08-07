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

/**
 * Augment Cloudflare.Env (used by `import { env } from "cloudflare:workers"`).
 * Merges with the empty interface from @cloudflare/workers-types.
 */
declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      CACHE: KVNamespace;
      SESSION: KVNamespace;
      MEDIA: R2Bucket;
      BACKUPS: R2Bucket;
      LOGS?: R2Bucket;
      EMAIL_TEMPLATES?: R2Bucket;
      REPORTS?: R2Bucket;
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
      VARIANT_INVENTORY_DO: DurableObjectNamespace;
      IDEMPOTENCY_DO: DurableObjectNamespace;
      AI_BUDGET: DurableObjectNamespace;
      WAF_RULES: DurableObjectNamespace;
      CART_DO: DurableObjectNamespace;
      DIRECT_CHECKOUT_DO: DurableObjectNamespace;
      PROVIDER_HEALTH_DO: DurableObjectNamespace;
      PAYMENT_WEBHOOKS: Queue;
      ORDER_EMAILS: Queue;
      IMAGE_PROCESSING: Queue;
      FRAUD_AUDIT: Queue;
      D1_BACKUP: Queue;
      CART_ACTIVITY: Queue;
      ANALYTICS: AnalyticsEngineDataset;
      TURNSTILE_SITE_KEY?: string;
      TURNSTILE_SECRET_KEY?: string;
      ALLOW_DEV_PHONE_OTP?: string;
      RESEND_API_KEY?: string;
      RESEND_FROM_EMAIL?: string;
      EMAIL_PROVIDER?: 'resend' | 'cloudflare_email';
      POS_BIN?: string;
      POS_TIN?: string;
      PATHAO_CLIENT_ID?: string;
      PATHAO_CLIENT_SECRET?: string;
      PATHAO_BASE_URL?: string;
      STEADFAST_API_KEY?: string;
      STEADFAST_SECRET?: string;
      STEADFAST_BASE_URL?: string;
      REDX_API_TOKEN?: string;
      REDX_BASE_URL?: string;
    }
  }
}

export type Env = Cloudflare.Env;

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
