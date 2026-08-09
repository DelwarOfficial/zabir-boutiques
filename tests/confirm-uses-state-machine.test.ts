import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canTransition } from '../src/lib/order-state-machine';

describe('K-37: confirm.ts asserts against the canonical order state machine', () => {
  it('confirm.ts imports and calls canTransition instead of relying only on ad-hoc checks', () => {
    const src = readFileSync(resolve('./src/pages/api/staff/orders/[id]/confirm.ts'), 'utf8');
    expect(src).toContain("from '../../../../../lib/order-state-machine'");
    expect(src).toContain("canTransition(order.status as Parameters<typeof canTransition>[0], 'staff_confirmed')");
  });

  it('the state machine declares pending_payment -> staff_confirmed (matches confirm.ts behavior)', () => {
    expect(canTransition('pending_payment', 'staff_confirmed')).toBe(true);
  });

  it('the state machine declares pending_review -> staff_confirmed', () => {
    expect(canTransition('pending_review', 'staff_confirmed')).toBe(true);
  });

  it('the state machine correctly rejects cancelled -> staff_confirmed (terminal state)', () => {
    expect(canTransition('cancelled', 'staff_confirmed')).toBe(false);
  });
});
