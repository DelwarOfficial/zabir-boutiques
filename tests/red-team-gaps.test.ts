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

  it('falls back to SSLCommerz when UddoktaPay rejects the charge outright', async () => {
    // A 4xx means the provider received and refused the request, so no charge
    // exists upstream and failing over cannot double-charge (N-28).
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => '{}', json: async () => ({}) } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ status: 'SUCCESS', GatewayPageURL: 'https://sslcommerz.test/pay/1' }),
        json: async () => ({ status: 'SUCCESS', GatewayPageURL: 'https://sslcommerz.test/pay/1' }),
      } as unknown as Response);

    const result = await createPaymentCheckout(
      {
        UDDOKTAPAY_API_KEY: 'u-key',
        UDDOKTAPAY_BASE_URL: 'https://uddoktapay.test',
        SSLCOMMERZ_STORE_ID: 'store',
        SSLCOMMERZ_STORE_PASSWORD: 'pass',
        SSLCOMMERZ_BASE_URL: 'https://sslcommerz.test',
      },
      {
        paymentId: 'pay-1',
        invoiceId: 'inv-1',
        amountPaisa: 25000,
        customerName: 'Ada',
        customerEmail: 'ada@example.com',
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

  it('does NOT fall back to SSLCommerz after an ambiguous UddoktaPay failure', async () => {
    // A 5xx (like a timeout) may have created the charge before failing.
    // Sending the customer to a second provider would take payment twice for
    // one order, so this surfaces as a failure the customer can retry against
    // a payment record we can reconcile.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 503, text: async () => '{}', json: async () => ({}),
    } as unknown as Response);
    global.fetch = fetchMock;

    const result = await createPaymentCheckout(
      {
        UDDOKTAPAY_API_KEY: 'u-key',
        UDDOKTAPAY_BASE_URL: 'https://uddoktapay.test',
        SSLCOMMERZ_STORE_ID: 'store',
        SSLCOMMERZ_STORE_PASSWORD: 'pass',
        SSLCOMMERZ_BASE_URL: 'https://sslcommerz.test',
      },
      {
        paymentId: 'pay-2',
        invoiceId: 'inv-2',
        amountPaisa: 25000,
        customerName: 'Ada',
        customerEmail: 'ada@example.com',
        customerPhone: '01700000000',
        orderId: 'ord-2',
        type: 'full',
        redirectUrl: 'https://example.com/ok',
        cancelUrl: 'https://example.com/cancel',
      },
    );

    expect(result.ok).toBe(false);
    expect(result.provider).toBe('uddoktapay');
    // Exactly one upstream call: SSLCommerz was never contacted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

describe('P3 courier adapter canonical structure', () => {
  const providers = ['pathao', 'steadfast', 'redx'] as const;
  const files = ['client.ts', 'types.ts', 'errors.ts', 'mock.ts', 'index.ts'] as const;

  it('ships canonical courier integration files per provider', () => {
    for (const provider of providers) {
      for (const file of files) {
        expect(existsSync(`src/lib/integrations/courier/${provider}/${file}`), `${provider}/${file}`).toBe(true);
      }
    }
  });

  it('creates mock shipments through the courier factory', async () => {
    const { createCourierClient } = await import('../src/lib/integrations/courier');
    const client = createCourierClient('pathao', { DB: {} as D1Database, PROVIDER_HEALTH_DO: {} as DurableObjectNamespace }, { mock: true });
    const result = await client.createShipment({
      orderId: 'ZB-1001',
      recipientName: 'Ada',
      recipientPhone: '01700000000',
      recipientAddress: 'Wari, Dhaka',
      recipientCity: 'Dhaka',
      recipientZone: 'Dhaka',
      codAmountPaisa: 150000,
      weight: 0.5,
      itemCount: 1,
    });
    expect(result.ok).toBe(true);
    expect(result.trackingNumber).toContain('PATHAO-');
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