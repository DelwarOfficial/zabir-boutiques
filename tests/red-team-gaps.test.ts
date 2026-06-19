import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { encryptTotpSecret, decryptTotpSecret } from '../src/lib/otp-secrets';
import { createPaymentCheckout } from '../src/lib/integrations/payments';
import { SSLCommerzClient } from '../src/lib/integrations/sslcommerz';
import { ImagifyClient } from '../src/lib/integrations/imagify';

describe('P1 SSLCommerz adapter', () => {
  it('ships canonical sslcommerz integration files', () => {
    for (const file of [
      'src/lib/integrations/sslcommerz/client.ts',
      'src/lib/integrations/sslcommerz/types.ts',
      'src/lib/integrations/sslcommerz/errors.ts',
      'src/lib/integrations/sslcommerz/mock.ts',
      'src/lib/integrations/sslcommerz/index.ts',
    ]) {
      expect(existsSync(file), file).toBe(true);
    }
  });

  it('falls back to SSLCommerz when UddoktaPay checkout fails', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'SUCCESS', GatewayPageURL: 'https://sslcommerz.test/pay/1' }),
      } as Response);

    const result = await createPaymentCheckout(
      {
        UDDOKTAPAY_API_KEY: 'u-key',
        UDDOKTAPAY_BASE_URL: 'https://uddoktapay.test',
        SSLCOMMERZ_STORE_ID: 'store',
        SSLCOMMERZ_STORE_PASSWORD: 'pass',
        SSLCOMMERZ_BASE_URL: 'https://sslcommerz.test',
      },
      {
        invoiceId: 'inv-1',
        amountPaisa: 25000,
        customerName: 'Ada',
        customerPhone: '01700000000',
        orderId: 'ord-1',
        type: 'full',
        redirectUrl: 'https://example.com/ok',
        cancelUrl: 'https://example.com/cancel',
      },
    );

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('sslcommerz');
    expect(result.paymentUrl).toContain('sslcommerz.test');
  });
});

describe('P1 otp_secrets encryption', () => {
  it('round-trips encrypted TOTP secrets', async () => {
    const cipher = await encryptTotpSecret('JBSWY3DPEHPK3PXP', 'test-session-secret-32-bytes-min!!');
    const plain = await decryptTotpSecret(cipher, 'test-session-secret-32-bytes-min!!');
    expect(plain).toBe('JBSWY3DPEHPK3PXP');
  });
});

describe('P2 Imagify canonical path', () => {
  it('exposes imagify adapter files', () => {
    expect(existsSync('src/lib/integrations/imagify/client.ts')).toBe(true);
    expect(readFileSync('src/lib/tinify.ts', 'utf8')).toContain("integrations/imagify");
  });

  it('compresses through ImagifyClient wrapper', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ Location: 'https://imagify.test/result' }),
      json: async () => ({ input: { size: 10 }, output: { size: 5, type: 'image/webp' } }),
    } as Response);

    const client = new ImagifyClient();
    const result = await client.compressImage(new Uint8Array([1, 2, 3]).buffer, 'imagify-key');
    expect(result.ok).toBe(true);
  });
});

describe('P2 static routes from Master Plan §3.4', () => {
  it('includes collections and blog slug routes', () => {
    expect(readFileSync('src/pages/collections/[slug].astro', 'utf8')).toMatch(/export\s+const\s+prerender\s*=\s*true/);
    expect(readFileSync('src/pages/blog/[slug].astro', 'utf8')).toMatch(/export\s+const\s+prerender\s*=\s*true/);
  });
});

describe('P0 migration plan mapping', () => {
  it('maps repo migration numbers to V7 schema concepts', () => {
    const mapping: Record<string, string> = {
      '0021_create_otp_secrets.sql': 'otp_secrets',
      '0022_create_api_audit_logs.sql': 'api_audit_logs',
      '0023_create_ai_budget_limits.sql': 'ai_budget_limits',
      '0024_stock_reservations_unique_constraint.sql': 'stock_reservations index',
      '0025_cart_activity_v7_cleanup.sql': 'abandoned_email_sent_at',
      '0029_customer_phone_otp.sql': 'customer_phone_otps',
    };
    for (const [file, concept] of Object.entries(mapping)) {
      expect(existsSync(`db/migrations/${file}`), `${concept} migration`).toBe(true);
    }
  });
});

describe('SSLCommerz verify adapter', () => {
  it('maps VALID status to paid', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'VALID', amount: '150.00', tran_id: 'inv-ssl', value_a: 'ord-9' }),
    } as Response);

    const verified = await new SSLCommerzClient({
      SSLCOMMERZ_STORE_ID: 'store',
      SSLCOMMERZ_STORE_PASSWORD: 'pass',
      SSLCOMMERZ_BASE_URL: 'https://sslcommerz.test',
    }).verifyPayment('inv-ssl');

    expect(verified.status).toBe('paid');
    expect(verified.amountPaisa).toBe(15000);
  });
});