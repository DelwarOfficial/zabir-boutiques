import { describe, it, expect } from 'vitest';
import { calculatePrepayment, PREPAYMENT_QUANTITY_THRESHOLD, PREPAYMENT_MESSAGE } from '../src/lib/prepayment';

describe('calculatePrepayment', () => {
  it('no prepayment for 1-2 item COD orders', () => {
    const r1 = calculatePrepayment(1, 10000, 'cod');
    expect(r1.required).toBe(false);
    expect(r1.advancePaisa).toBe(0);
    expect(r1.balancePaisa).toBe(10000);

    const r2 = calculatePrepayment(2, 20000, 'cod');
    expect(r2.required).toBe(false);
  });

  it('requires 50% prepayment for COD with >2 items', () => {
    const r = calculatePrepayment(3, 10000, 'cod');
    expect(r.required).toBe(true);
    expect(r.advancePaisa).toBe(5000);
    expect(r.balancePaisa).toBe(5000);
    expect(r.message).toBe(PREPAYMENT_MESSAGE);
  });

  it('uses integer ceil for odd total', () => {
    const r = calculatePrepayment(4, 10001, 'cod');
    expect(r.advancePaisa).toBe(5001);
    expect(r.balancePaisa).toBe(5000);
    expect(r.advancePaisa + r.balancePaisa).toBe(10001);
  });

  it('in_store orders are always exempt', () => {
    const r = calculatePrepayment(10, 50000, 'in_store');
    expect(r.required).toBe(false);
    expect(r.advancePaisa).toBe(0);
  });

  it('full uddoktapay payment is exempt (customer pays full online)', () => {
    const r = calculatePrepayment(5, 30000, 'uddoktapay');
    expect(r.required).toBe(false);
    expect(r.advancePaisa).toBe(30000);
    expect(r.balancePaisa).toBe(0);
  });

  it('partial_prepay always returns not required with computed split', () => {
    const r = calculatePrepayment(5, 20000, 'partial_prepay');
    expect(r.required).toBe(false);
    expect(r.advancePaisa).toBe(10000);
    expect(r.balancePaisa).toBe(10000);
    expect(r.message).toBeNull();
  });

  it('partial_prepay uses integer ceil for odd total', () => {
    const r = calculatePrepayment(3, 10001, 'partial_prepay');
    expect(r.advancePaisa).toBe(5001);
    expect(r.balancePaisa).toBe(5000);
    expect(r.advancePaisa + r.balancePaisa).toBe(10001);
    expect(r.message).toBeNull();
  });

  it('threshold is exactly 2', () => {
    expect(PREPAYMENT_QUANTITY_THRESHOLD).toBe(2);
  });
});
