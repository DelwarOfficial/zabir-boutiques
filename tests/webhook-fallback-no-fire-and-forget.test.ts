import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('K-05: webhook fallback path awaits processing instead of fire-and-forget', () => {
  const src = readFileSync(resolve('./src/pages/api/payments/webhook.ts'), 'utf8');

  it('no longer has the bare `void work` fire-and-forget fallback', () => {
    expect(src).not.toContain('void work;');
  });

  it('awaits processPaymentWebhookMessage directly when neither queue nor waitUntil is available', () => {
    expect(src).toContain('await processPaymentWebhookMessage(env, invoiceId);');
  });

  it('still uses waitUntil (non-blocking) when available', () => {
    expect(src).toContain('cfContext.waitUntil(processPaymentWebhookMessage(env, invoiceId));');
  });
});
