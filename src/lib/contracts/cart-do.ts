import type { CartDOState } from '../../do/cart-do';

export interface CartDOContract {
  addItem(input: { variantId: string; quantity: number; clientVersion?: number }): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number; error?: string; code?: string }>;
  removeItem(input: { variantId: string; clientVersion?: number }): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number; error?: string }>;
  changeQuantity(input: { variantId: string; quantity: number; clientVersion?: number }): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number; error?: string; code?: string }>;
  clearCart(input: { clientVersion?: number }): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }>;
  getCart(input: unknown): Promise<{ ok: true; cart: CartDOState; currentVersion: number }>;
  applyCoupon(input: { couponCode: string; clientVersion?: number }): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }>;
  removeCoupon(input: { clientVersion?: number }): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }>;
  updateCustomerContact(input: { customerContact: { name?: string; phone?: string; email?: string; consent_status: 'unknown' | 'allowed' | 'denied' }; clientVersion?: number }): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }>;
  mergeCart(input: { items: Array<{ variantId: string; quantity: number; addedAt?: string; updatedAt?: string }>; clientVersion?: number }): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }>;
  replaceAll(input: { items: Array<{ variantId: string; quantity: number }>; clientVersion?: number }): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }>;
  alarm(): Promise<void>;
}
