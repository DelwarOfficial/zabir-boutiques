import { describe, it, expect } from 'vitest';
import { calculatePrepayment, PREPAYMENT_MESSAGE } from '../src/lib/prepayment';

describe('checkout prepayment rule (Master Plan §6.1 step 9)', () => {
  it('COD with >2 distinct items requires prepayment (402 path)', () => {
    const decision = calculatePrepayment(3, 20000, 'cod');
    expect(decision.required).toBe(true);
    expect(decision.advancePaisa).toBe(10000);
    expect(decision.balancePaisa).toBe(10000);
    expect(decision.message).toBe(PREPAYMENT_MESSAGE);
  });

  it('COD with ≤2 items does not require prepayment', () => {
    expect(calculatePrepayment(2, 20000, 'cod').required).toBe(false);
    expect(calculatePrepayment(1, 20000, 'cod').required).toBe(false);
  });

  it('partial_prepay retry path is accepted after 402', () => {
    const split = calculatePrepayment(5, 10001, 'partial_prepay');
    expect(split.required).toBe(false);
    expect(split.advancePaisa + split.balancePaisa).toBe(10001);
  });
});