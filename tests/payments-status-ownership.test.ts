import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('K-04: payments/status requires ownership proof (phone + order_number)', () => {
  const src = readFileSync(resolve('./src/pages/api/payments/status/[id].ts'), 'utf8');

  it('rejects when phone or order_number is missing, before touching DB', () => {
    expect(src).toContain("if (!phoneResult.ok || !orderNumber)");
    expect(src).toContain("'Missing phone or order_number'");
  });

  it('query joins orders and filters by order_number + phone (not id alone)', () => {
    expect(src).toContain('JOIN orders o ON o.id = p.order_id');
    expect(src).toContain('o.order_number = ?2 AND o.phone = ?3');
  });

  it('no longer does a bare SELECT ... WHERE id = ?1 with no ownership filter', () => {
    expect(src).not.toMatch(/FROM payments WHERE id = \?1\s*`/);
  });
});
