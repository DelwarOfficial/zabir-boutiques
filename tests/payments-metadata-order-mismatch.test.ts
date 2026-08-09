import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('K-07: applyPaymentVerified fails closed when metadata is missing/malformed, not open', () => {
  const src = readFileSync(resolve('./src/lib/payments.ts'), 'utf8');

  it('no longer skips the order_id check when verified.metadata is absent', () => {
    expect(src).not.toContain('if (verified.metadata && typeof verified.metadata.order_id === \'string\' && verified.metadata.order_id !== payment.order_id)');
  });

  it('treats missing/malformed metadata.order_id as a mismatch (fails closed)', () => {
    expect(src).toContain('const verifiedOrderId = verified.metadata && typeof verified.metadata.order_id === \'string\' ? verified.metadata.order_id : null;');
    expect(src).toContain('if (verifiedOrderId !== payment.order_id)');
  });
});
