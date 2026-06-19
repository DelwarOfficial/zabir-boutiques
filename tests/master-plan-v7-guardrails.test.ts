import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getEmailProvider } from '../src/lib/integrations/email';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function listRouteFiles(dir = 'src/pages'): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listRouteFiles(path);
    return /\.(astro|ts)$/.test(entry.name) ? [path] : [];
  });
}

describe('Master Plan V7 rendering guardrails', () => {
  it('uses Astro server output', () => {
    expect(read('astro.config.mjs')).toMatch(/output:\s*["']server["']/);
    expect(read('astro.config.mjs')).not.toMatch(/output:\s*["'](?:static|hybrid)["']/);
  });

  it('does not use route-level dynamic opt-out flags', () => {
    const offenders = listRouteFiles().filter((file) => /prerender\s*=\s*false/.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it('public static catalog pages opt into prerendering', () => {
    for (const file of ['src/pages/index.astro', 'src/pages/products/[slug].astro', 'src/pages/categories/[slug].astro']) {
      expect(read(file), file).toMatch(/export\s+const\s+prerender\s*=\s*true/);
    }
  });

  it('dynamic commerce and staff routes do not opt into prerendering', () => {
    for (const file of [
      'src/pages/checkout.astro',
      'src/pages/orders.astro',
      'src/pages/order-track.astro',
      'src/pages/staff/login.astro',
      'src/pages/staff/sales/pos.astro',
    ]) {
      expect(read(file), file).not.toMatch(/export\s+const\s+prerender\s*=\s*true/);
    }
  });
});

describe('Master Plan V7 migration guardrails', () => {
  it('includes required schema migrations and rollbacks', () => {
    for (const file of [
      'db/migrations/0021_create_otp_secrets.sql',
      'db/migrations/0022_create_api_audit_logs.sql',
      'db/migrations/0023_create_ai_budget_limits.sql',
      'db/migrations/0024_stock_reservations_unique_constraint.sql',
      'db/migrations/0025_cart_activity_v7_cleanup.sql',
      'db/migrations/0026_add_checkout_vat_paisa.sql',
      'db/migrations/rollback/0021_rollback_create_otp_secrets.sql',
      'db/migrations/rollback/0022_rollback_create_api_audit_logs.sql',
      'db/migrations/rollback/0023_rollback_create_ai_budget_limits.sql',
      'db/migrations/rollback/0024_rollback_stock_reservations_unique_constraint.sql',
      'db/migrations/rollback/0025_rollback_cart_activity_v7_cleanup.sql',
      'db/migrations/rollback/0026_rollback_add_checkout_vat_paisa.sql',
      'db/migrations/0029_customer_phone_otp.sql',
      'db/migrations/rollback/0029_rollback_customer_phone_otp.sql',
    ]) {
      expect(existsSync(file), file).toBe(true);
    }
  });

  it('adds reservation race-prevention and abandoned-cart cleanup SQL', () => {
    expect(read('db/migrations/0024_stock_reservations_unique_constraint.sql')).toContain('idx_stock_reservations_order_active');
    const cartMigration = read('db/migrations/0025_cart_activity_v7_cleanup.sql');
    expect(cartMigration).toContain('abandoned_email_sent_at');
    expect(cartMigration).toContain('DROP COLUMN abandoned_1h_sent_at');
    expect(cartMigration).toContain('DROP COLUMN abandoned_24h_sent_at');
  });
});

describe('Master Plan V7 commerce guardrails', () => {
  it('checkout ignores client VAT and computes VAT from env', () => {
    const checkout = read('src/pages/api/checkout.ts');
    expect(checkout).toContain('VAT_RATE_PERCENT');
    expect(checkout).toContain('vat_paisa');
    expect(read('src/lib/checkout-pricing.ts')).toContain('vat_paisa');
  });

  it('checkout COD rule uses total unit quantity', () => {
    const checkout = read('src/pages/api/checkout.ts');
    expect(checkout).toContain('items.reduce((sum, item) => sum + item.qty, 0)');
    expect(checkout).not.toContain('calculatePrepayment(items.length');
  });

  it('CartDO arms the inactivity alarm and persists cart_activity in alarm', () => {
    const cartDo = read('src/do/cart-do.ts');
    expect(cartDo).toContain('setAlarm(Date.now() + 5 * 60 * 1000)');
    expect(cartDo).toContain('INSERT INTO cart_activity');
  });

  it('POS directSale failure path has reverseDirectSale compensation', () => {
    expect(read('src/do/variant-inventory-do.ts')).toContain('reverseDirectSale');
    expect(read('src/lib/do-client.ts')).toContain('doReverseDirectSale');
    const invoices = read('src/lib/invoices.ts');
    expect(invoices).toContain('compensateDirectSales');
    expect(invoices).toContain('pos_compensating_transaction');
  });

  it('FraudBD circuit breaker critical values are present', () => {
    const providerHealth = read('src/do/provider-health-do.ts');
    expect(providerHealth).toContain('failureThreshold: 5');
    expect(providerHealth).toContain('5 * 60 * 1000');
    expect(providerHealth).toContain('60 * 1000');
    expect(read('src/lib/fraud.ts')).toContain('fallback_score":50');
  });

  it('Buy Now session binding and cleanup are enforced', () => {
    expect(read('src/pages/api/buy-now/session.ts')).toContain('HMAC');
    const directDo = read('src/do/direct-checkout-session-do.ts');
    expect(directDo).toContain('ORIGIN_MISMATCH');
    expect(directDo).toContain('USER_AGENT_MISMATCH');
    expect(read('src/pages/api/buy-now/submit.ts')).toContain('https://do/clear');
  });

  it('BudgetCounterDO exposes strict DeepSeek budget methods', () => {
    const budget = read('src/do/budget-counter-do.ts');
    expect(budget).toContain('canUseDeepSeek');
    expect(budget).toContain('recordUsage');
    expect(budget).toContain('dailyUsdCents: 500');
    expect(budget).toContain('dailyCalls: 50');
  });

  it('abandoned cart flow uses 24h claim-before-enqueue and consumer re-check', () => {
    const consumers = read('src/queues/consumers.ts');
    expect(consumers).toContain("datetime('now', '-24 hours')");
    expect(consumers).toContain('ROW_NUMBER() OVER (PARTITION BY customer_email');
    expect(consumers).toContain('abandoned_email_sent_at IS NULL');
    expect(consumers).toContain('converted_order_id IS NULL');
    expect(consumers).toContain('cart_converted_before_reminder');
  });
});

describe('Master Plan V7 payment and image adapters', () => {
  it('includes SSLCommerz and Imagify canonical adapter paths', () => {
    for (const file of [
      'src/lib/integrations/sslcommerz/index.ts',
      'src/lib/integrations/imagify/index.ts',
      'src/lib/integrations/payments/index.ts',
    ]) {
      expect(existsSync(file), file).toBe(true);
    }
    expect(read('src/lib/integrations/payments/index.ts')).toContain('sslcommerz');
  });

  it('includes courier provider adapter directories', () => {
    for (const provider of ['pathao', 'steadfast', 'redx']) {
      for (const file of ['client.ts', 'types.ts', 'errors.ts', 'mock.ts', 'index.ts']) {
        expect(existsSync(`src/lib/integrations/courier/${provider}/${file}`)).toBe(true);
      }
    }
    expect(read('src/lib/integrations/courier/index.ts')).toContain('createCourierClient');
  });
});

describe('PWA storefront guardrails', () => {
  it('ships manifest, offline shell, and e-commerce-safe service worker', () => {
    const manifest = JSON.parse(read('public/manifest.json'));
    expect(manifest.display).toBe('standalone');
    expect(existsSync('public/offline.html')).toBe(true);
    expect(read('src/layouts/RootLayout.astro')).toContain('rel="manifest"');
    expect(read('src/middleware.ts')).toContain("worker-src 'self'");
    expect(read('src/pwa/sw.template.js')).toContain('/checkout');
    expect(read('src/pwa/sw.template.js')).toContain('/api');
  });
});

describe('Master Plan V7 email provider selection', () => {
  it('defaults to Resend and selects Cloudflare Email by EMAIL_PROVIDER', () => {
    expect(getEmailProvider({}).constructor.name).toBe('ResendEmailProvider');
    expect(getEmailProvider({ EMAIL_PROVIDER: 'cloudflare_email' }).constructor.name).toBe('CloudflareEmailProvider');
  });
});
