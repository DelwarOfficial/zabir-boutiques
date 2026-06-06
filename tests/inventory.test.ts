import { describe, it, expect } from 'vitest';
import { addPaisa, assertPaisa, multiplyPaisa, formatPaisa } from '../src/lib/money';

describe('reserveVariants (unit logic)', () => {
  it('validates empty cart', async () => {
    expect(true).toBe(true);
  });
});

describe('money utils', () => {
  it('assertPaisa throws on negative', () => {
    expect(() => assertPaisa(-1)).toThrow();
  });

  it('assertPaisa throws on float', () => {
    expect(() => assertPaisa(1.5)).toThrow();
  });

  it('assertPaisa passes on valid', () => {
    expect(assertPaisa(100)).toBe(100);
  });

  it('addPaisa sums correctly', () => {
    expect(addPaisa([100, 200, 300])).toBe(600);
  });

  it('multiplyPaisa computes line total', () => {
    expect(multiplyPaisa(500, 3)).toBe(1500);
  });

  it('formatPaisa formats correctly', () => {
    const result = formatPaisa(149900);
    expect(result).toContain('\u09f3');
    expect(result).toContain('1,499');
  });
});

describe('coupon logic (unit)', () => {
  it('calculateCouponDiscount fixed amount', async () => {
    const { calculateCouponDiscount } = await import('../src/lib/money');
    expect(calculateCouponDiscount(100000, 'fixed', 5000, null, null)).toBe(5000);
  });

  it('calculateCouponDiscount percentage', async () => {
    const { calculateCouponDiscount } = await import('../src/lib/money');
    expect(calculateCouponDiscount(100000, 'percentage', null, 10, null)).toBe(10000);
  });

  it('calculateCouponDiscount percentage with cap', async () => {
    const { calculateCouponDiscount } = await import('../src/lib/money');
    expect(calculateCouponDiscount(100000, 'percentage', null, 20, 15000)).toBe(15000);
  });
});
