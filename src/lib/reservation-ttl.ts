/**
 * Canonical reservation TTL (Master_Prompt v7.0 §6.3).
 *
 * Every layer that governs a stock reservation's lifetime MUST derive the
 * expiry from this single source, otherwise the real-time gate (the
 * VariantInventoryDO) and the D1 source-of-truth drift apart (INV-3):
 *   - VariantInventoryDO sweeps a reservation at `reserveTime + TTL_MS`.
 *   - orders.ts stamps `stock_reservations.expires_at = created_at + TTL_MINUTES`.
 *   - cleanExpiredReservations releases a reservation once `expires_at` is past.
 * All three must agree, or available stock reported by the DO and the
 * reserved_quantity persisted in D1 disagree.
 */
export const RESERVATION_TTL_MINUTES = 10;
export const RESERVATION_TTL_MS = RESERVATION_TTL_MINUTES * 60 * 1000;
