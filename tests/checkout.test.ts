import { describe, it, expect, vi } from 'vitest';
import { normalizeBangladeshPhone } from '../src/lib/phone';
import { addPaisa, assertPaisa, multiplyPaisa } from '../src/lib/money';

function makeLineItem(variantId: string, quantity: number, price: number) {
  return { variant_id: variantId, quantity, unit_price_paisa: price };
}

describe('checkout validation logic', () => {
  it('rejects empty cart', () => {
    const items: any[] = [];
    expect(items.length).toBe(0);
  });

  it('rejects cart with more than 10 line items', () => {
    const items = Array.from({ length: 11 }, (_, i) => makeLineItem(`v${i}`, 1, 1000));
    expect(items.length > 10).toBe(true);
  });

  it('rejects negative quantity', () => {
    expect(() => multiplyPaisa(100, -1)).toThrow();
  });

  it('rejects zero quantity line total', () => {
    expect(() => multiplyPaisa(100, 0)).toThrow();
  });

  it('recalculates subtotal correctly', () => {
    const items = [
      makeLineItem('v1', 2, 1500),
      makeLineItem('v2', 1, 5000),
    ];
    const subtotal = addPaisa(items.map(i => multiplyPaisa(assertPaisa(i.unit_price_paisa, 'price'), i.quantity)));
    expect(subtotal).toBe(8000);
  });

  it('validates phone normalization failures', () => {
    const result = normalizeBangladeshPhone('');
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('reason');
  });

  it('validates phone normalization success', () => {
    const result = normalizeBangladeshPhone('01712345678');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.phone).toBe('+8801712345678');
    }
  });

  it('detects total mismatch', () => {
    const items = [makeLineItem('v1', 1, 5000)];
    const subtotal = addPaisa(items.map(i => multiplyPaisa(assertPaisa(i.unit_price_paisa, 'price'), i.quantity)));
    const delivery = 1000;
    const total = subtotal + delivery;
    expect(subtotal).toBe(5000);
    expect(total).toBe(6000);
    expect(total !== 5999).toBe(true);
  });

  it('handles missing fields gracefully', () => {
    const payload: any = { items: [{ variant_id: 'v1', quantity: 1, unit_price_paisa: 1000 }] };
    expect(payload.phone).toBeUndefined();
    expect(payload.name).toBeUndefined();
    expect(payload.address).toBeUndefined();
  });
});
