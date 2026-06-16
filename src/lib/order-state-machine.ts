/**
 * Order State Machine [Master_Prompt v7.0 §7.1, G11]
 *
 * Centralized transition table. Every API route that mutates an order
 * status MUST go through `canTransition` + `transitionOrder` to prevent
 * invalid jumps (e.g. pending_review → delivered).
 *
 * The transition table also declares the *side effects* attached to
 * each transition (restock on cancel, refund on refund, etc.) so the
 * caller doesn't have to remember them.
 */

export type OrderStatus =
  | "pending_review"
  | "pending_payment"
  | "payment_verified"
  | "paid_over_allocated"
  | "staff_confirmed"
  | "packing"
  | "shipped"
  | "delivered"
  | "returned"
  | "cancelled"
  | "refunded";

export type SideEffect =
  | "restock"
  | "refund_full"
  | "refund_partial"
  | "send_email_confirmed"
  | "send_email_shipped"
  | "send_email_delivered"
  | "send_email_returned"
  | "send_email_cancelled";

interface TransitionRule {
  to: OrderStatus;
  effects: SideEffect[];
  /** If true, this transition requires fraud.override (owner-tier). */
  requireFraudOverride?: boolean;
}

const TRANSITIONS: Record<OrderStatus, TransitionRule[]> = {
  pending_review: [
    { to: "staff_confirmed", effects: ["send_email_confirmed"] },
    { to: "pending_payment", effects: [] },
    { to: "cancelled", effects: ["restock", "send_email_cancelled"] },
  ],
  pending_payment: [
    { to: "payment_verified", effects: ["send_email_confirmed"] },
    { to: "cancelled", effects: ["restock", "send_email_cancelled"] },
  ],
  payment_verified: [
    { to: "staff_confirmed", effects: ["send_email_confirmed"] },
    { to: "paid_over_allocated", effects: [] },
    { to: "cancelled", effects: ["restock", "refund_full", "send_email_cancelled"] },
  ],
  paid_over_allocated: [
    { to: "staff_confirmed", effects: ["send_email_confirmed"] },
    { to: "cancelled", effects: ["restock", "refund_full", "send_email_cancelled"] },
  ],
  staff_confirmed: [
    { to: "packing", effects: [] },
    { to: "cancelled", effects: ["restock", "refund_full", "send_email_cancelled"] },
  ],
  packing: [
    { to: "shipped", effects: ["send_email_shipped"] },
    { to: "cancelled", effects: ["restock", "refund_full", "send_email_cancelled"] },
  ],
  shipped: [
    { to: "delivered", effects: ["send_email_delivered"] },
    { to: "returned", effects: [] },
  ],
  delivered: [
    { to: "returned", effects: ["send_email_returned"] },
  ],
  returned: [
    { to: "refunded", effects: ["restock", "refund_partial", "send_email_returned"] },
  ],
  cancelled: [], // terminal
  refunded: [],  // terminal
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.some((rule) => rule.to === to) ?? false;
}

export function getTransition(from: OrderStatus, to: OrderStatus): TransitionRule | null {
  return TRANSITIONS[from]?.find((rule) => rule.to === to) ?? null;
}

export function listAllowedTransitions(from: OrderStatus): OrderStatus[] {
  return (TRANSITIONS[from] ?? []).map((r) => r.to);
}

export { TRANSITIONS };
