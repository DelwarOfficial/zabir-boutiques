import { describe, it, expect } from "vitest";
import { canTransition, getTransition, listAllowedTransitions, TRANSITIONS } from "../src/lib/order-state-machine";

describe("order state machine [Master_Prompt v7.0 §7.1]", () => {
  it("allows the documented forward path pending_review → ... → delivered", () => {
    expect(canTransition("pending_review", "staff_confirmed")).toBe(true);
    expect(canTransition("staff_confirmed", "packing")).toBe(true);
    expect(canTransition("packing", "shipped")).toBe(true);
    expect(canTransition("shipped", "delivered")).toBe(true);
  });

  it("allows delivered → returned", () => {
    expect(canTransition("delivered", "returned")).toBe(true);
    expect(canTransition("returned", "refunded")).toBe(true);
  });

  it("rejects invalid jumps (pending_review → delivered is not allowed)", () => {
    expect(canTransition("pending_review", "delivered")).toBe(false);
    expect(canTransition("cancelled", "delivered")).toBe(false); // cancelled is terminal
    expect(canTransition("refunded", "delivered")).toBe(false);  // refunded is terminal
  });

  it("attaches the restock side effect to every cancelled transition", () => {
    for (const from of Object.keys(TRANSITIONS) as Array<keyof typeof TRANSITIONS>) {
      const rule = getTransition(from, "cancelled");
      if (rule) expect(rule.effects).toContain("restock");
    }
  });

  it("attaches refund_full to cancellation from a paid state", () => {
    expect(getTransition("payment_verified", "cancelled")?.effects).toContain("refund_full");
    expect(getTransition("staff_confirmed", "cancelled")?.effects).toContain("refund_full");
    expect(getTransition("packing", "cancelled")?.effects).toContain("refund_full");
  });

  it("attaches refund_partial to returned → refunded", () => {
    expect(getTransition("returned", "refunded")?.effects).toContain("refund_partial");
  });

  it("listAllowedTransitions excludes terminal states", () => {
    expect(listAllowedTransitions("cancelled")).toEqual([]);
    expect(listAllowedTransitions("refunded")).toEqual([]);
    expect(listAllowedTransitions("pending_review").length).toBeGreaterThan(0);
  });
});
