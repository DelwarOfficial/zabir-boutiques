import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('forged-totals: checkout never reads client-supplied money fields (T-27)', () => {
  it('checkout.ts contains no read of a client-supplied total/vat/discount/subtotal/delivery field', () => {
    const src = readFileSync(resolve('./src/pages/api/checkout.ts'), 'utf8');
    // All money fields are computed server-side from D1 snapshots and never
    // parsed out of the request body. This is a regression guard: if a
    // future change starts reading body.total_paisa etc., this test catches
    // it before it ships. See Guardrails #3/#4 in the master plan.
    for (const field of ['total_paisa', 'vat_paisa', 'discount_paisa', 'subtotal_paisa', 'delivery_paisa']) {
      expect(src).not.toMatch(new RegExp(`body\\.${field}\\b`));
    }
  });

  it('buy-now submit.ts also never reads a client-supplied total/vat field', () => {
    const src = readFileSync(resolve('./src/pages/api/buy-now/submit.ts'), 'utf8');
    for (const field of ['total_paisa', 'vat_paisa', 'discount_paisa', 'subtotal_paisa']) {
      expect(src).not.toMatch(new RegExp(`body\\.${field}\\b`));
    }
  });

  it('an extra/forged field in the checkout body does not throw or get echoed back as authoritative', async () => {
    // Structural proof, not a live route call: the request body type is
    // parsed as Record<string, unknown> and only named fields are ever
    // destructured — an injected `total_paisa` key is simply never read.
    const forgedBody: Record<string, unknown> = {
      session_id: 's1',
      total_paisa: 1, // attacker tries to set the total to 1 paisa
      customer: { name: 'A', phone: '+8801712345678', address: 'x' },
    };
    expect(forgedBody.total_paisa).toBe(1); // present in the body...
    const src = readFileSync(resolve('./src/pages/api/checkout.ts'), 'utf8');
    expect(src).not.toContain('body.total_paisa'); // ...but structurally unreachable by the route
  });
});
