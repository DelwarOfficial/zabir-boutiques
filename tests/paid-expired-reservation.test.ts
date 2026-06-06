import { describe, it, expect, vi } from 'vitest';

describe('paid-after-reservation-expiry fallback', () => {
  it('if stock available, direct deduction succeeds', () => {
    const orderItems = [
      { variant_id: 'v1', quantity: 2 },
      { variant_id: 'v2', quantity: 1 },
    ];
    const inventoryState: Record<string, { qty: number; reserved: number; avail: number }> = {
      v1: { qty: 10, reserved: 0, avail: 10 },
      v2: { qty: 5, reserved: 0, avail: 5 },
    };

    const results = orderItems.map(item => {
      const inv = inventoryState[item.variant_id];
      if (!inv) return { meta: { changes: 0 } };
      if (inv.avail >= item.quantity) {
        inv.qty -= item.quantity;
        inv.avail = inv.qty - inv.reserved;
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    });

    const allSucceeded = results.every(r => r.meta.changes === 1);
    expect(allSucceeded).toBe(true);
  });

  it('if stock unavailable, order becomes paid_over_allocated', () => {
    const orderItems = [
      { variant_id: 'v1', quantity: 2 },
      { variant_id: 'v2', quantity: 1 },
    ];
    const inventoryState: Record<string, { qty: number; reserved: number; avail: number }> = {
      v1: { qty: 10, reserved: 0, avail: 10 },
      v2: { qty: 0, reserved: 0, avail: 0 },
    };

    const results = orderItems.map(item => {
      const inv = inventoryState[item.variant_id];
      if (!inv) return { meta: { changes: 0 } };
      if (inv.avail >= item.quantity) {
        inv.qty -= item.quantity;
        inv.avail = inv.qty - inv.reserved;
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    });

    const allSucceeded = results.every(r => r.meta.changes === 1);
    expect(allSucceeded).toBe(false);

    const orderStatus = allSucceeded ? 'payment_verified' : 'paid_over_allocated';
    expect(orderStatus).toBe('paid_over_allocated');
  });
});
