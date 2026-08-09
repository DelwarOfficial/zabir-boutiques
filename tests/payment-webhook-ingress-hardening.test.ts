import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readWebhookSignature } from '../src/lib/payment-webhook-ingress';

describe('K-02: webhook signature header is a closed list', () => {
  it('ignores X-Signature and Signature, only reads X-UddoktaPay-Signature', () => {
    const req = new Request('https://x/webhook', {
      headers: { 'X-Signature': 'attacker', 'Signature': 'attacker2' },
    });
    expect(readWebhookSignature(req)).toBe('');
  });

  it('reads X-UddoktaPay-Signature', () => {
    const req = new Request('https://x/webhook', {
      headers: { 'X-UddoktaPay-Signature': 'sha256=abc' },
    });
    expect(readWebhookSignature(req)).toBe('sha256=abc');
  });
});

describe('K-01: IPN key check is fail-closed when configured', () => {
  it('webhook.ts requires the header when UDDOKTAPAY_API_KEY is set (no header-omission bypass)', () => {
    const src = readFileSync(resolve('./src/pages/api/payments/webhook.ts'), 'utf8');
    expect(src).toContain('if (env.UDDOKTAPAY_API_KEY) {');
    expect(src).toContain('if (!ipnKey || !timingSafeEqualHex(ipnKey, env.UDDOKTAPAY_API_KEY))');
  });
});
