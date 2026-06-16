import { describe, expect, it } from "vitest";
import { formatPaisa, renderStaffPosInvoiceHtml } from "../src/lib/staff-pos-invoice";

const order = {
  id: "order-1",
  order_number: "ZB-20260617-ABC123",
  name: "Walk In <Customer>",
  phone: "01712345678",
  address: "In-store pickup",
  note: "Gift wrap & staple",
  subtotal_paisa: 245000,
  delivery_paisa: 0,
  discount_paisa: 5000,
  total_paisa: 240000,
  payment_method: "in_store",
  payment_status: "paid",
  status: "staff_confirmed",
  order_channel: "in_store",
  created_at: "2026-06-17 12:30:00",
  created_by_name: "Sales Staff"
};

describe("staff POS invoice renderer", () => {
  it("formats integer paisa as taka without floating point money input", () => {
    expect(formatPaisa(123456)).toBe("Tk 1234.56");
    expect(formatPaisa(0)).toBe("Tk 0.00");
  });

  it("renders a printable paid in-store invoice with items and totals", () => {
    const html = renderStaffPosInvoiceHtml(order, [
      {
        product_name: "Premium Kurti",
        variant_label: "M / Red",
        quantity: 2,
        unit_price_paisa: 125000,
        total_price_paisa: 250000
      }
    ]);

    expect(html).toContain("POS Invoice - ZB-20260617-ABC123");
    expect(html).toContain("In-store POS");
    expect(html).toContain("Premium Kurti");
    expect(html).toContain("M / Red");
    expect(html).toContain("Tk 2400.00");
    expect(html).toContain("PAID - COUNTER SALE");
    expect(html).toContain("window.print()");
  });

  it("escapes customer and item text before embedding in HTML", () => {
    const html = renderStaffPosInvoiceHtml(order, [
      {
        product_name: "<script>alert(1)</script>",
        variant_label: `"XL" & Blue`,
        quantity: 1,
        unit_price_paisa: 10000,
        total_price_paisa: 10000
      }
    ]);

    expect(html).toContain("Walk In &lt;Customer&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&quot;XL&quot; &amp; Blue");
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
