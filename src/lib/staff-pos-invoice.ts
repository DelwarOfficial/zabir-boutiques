export type StaffPosInvoiceOrder = {
  id: string;
  order_number: string;
  name: string;
  phone: string;
  address: string | null;
  note: string | null;
  subtotal_paisa: number;
  delivery_paisa: number;
  discount_paisa: number;
  total_paisa: number;
  payment_method: string;
  payment_status: string;
  status: string;
  order_channel: string | null;
  created_at: string;
  created_by_name: string | null;
};

export type StaffPosInvoiceItem = {
  product_name: string;
  variant_label: string | null;
  quantity: number;
  unit_price_paisa: number;
  total_price_paisa: number;
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatPaisa(paisa: number): string {
  const safe = Number.isFinite(paisa) ? paisa : 0;
  return `Tk ${(safe / 100).toFixed(2)}`;
}

export function renderStaffPosInvoiceHtml(order: StaffPosInvoiceOrder, items: StaffPosInvoiceItem[]): string {
  const rows = items.map((item, index) => `
      <tr>
        <td class="num">${index + 1}</td>
        <td>
          <div class="item-name">${escapeHtml(item.product_name)}</div>
          <div class="variant">${escapeHtml(item.variant_label || "Standard")}</div>
        </td>
        <td class="num">${escapeHtml(item.quantity)}</td>
        <td class="money">${escapeHtml(formatPaisa(item.unit_price_paisa))}</td>
        <td class="money">${escapeHtml(formatPaisa(item.total_price_paisa))}</td>
      </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>POS Invoice - ${escapeHtml(order.order_number)}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #f5f5f5;
    color: #111;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 12px;
  }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: center;
    padding: 12px;
    font-family: system-ui, -apple-system, sans-serif;
  }
  .actions button,
  .actions a {
    border: 1px solid #111;
    border-radius: 6px;
    background: #fff;
    color: #111;
    cursor: pointer;
    font: 600 13px system-ui, -apple-system, sans-serif;
    padding: 8px 12px;
    text-decoration: none;
  }
  .invoice {
    width: 80mm;
    margin: 0 auto 16px;
    background: #fff;
    padding: 5mm;
  }
  .brand { text-align: center; border-bottom: 1px dashed #111; padding-bottom: 8px; }
  .brand h1 { margin: 0 0 3px; font-size: 18px; letter-spacing: 0; }
  .brand p, .meta p, .customer p { margin: 2px 0; }
  .section { border-bottom: 1px dashed #111; padding: 8px 0; }
  .meta-row, .total-row { display: flex; justify-content: space-between; gap: 8px; }
  .label { color: #555; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { padding: 4px 0; vertical-align: top; }
  th { border-bottom: 1px solid #111; text-align: left; }
  .num { text-align: center; white-space: nowrap; }
  .money { text-align: right; white-space: nowrap; }
  .item-name { font-weight: 700; }
  .variant { color: #555; font-size: 11px; }
  .totals { padding-top: 8px; }
  .grand { border-top: 1px solid #111; margin-top: 4px; padding-top: 5px; font-weight: 900; font-size: 14px; }
  .paid { text-align: center; border: 1px solid #111; padding: 6px; font-weight: 900; margin-top: 8px; }
  .footer { text-align: center; padding-top: 8px; }
  @media print {
    body { background: #fff; }
    .actions { display: none; }
    .invoice { margin: 0; width: auto; padding: 0; }
  }
</style>
</head>
<body>
  <div class="actions">
    <button type="button" onclick="window.print()">Print Invoice</button>
    <a href="/staff/orders/${escapeHtml(order.id)}">Order Details</a>
    <a href="/staff/sales/instore">New Sale</a>
  </div>
  <main class="invoice" aria-label="POS invoice">
    <header class="brand">
      <h1>ZABIR BOUTIQUES</h1>
      <p>Wari, Dhaka</p>
      <p>+880 1985-516000</p>
    </header>

    <section class="section meta">
      <div class="meta-row"><span class="label">Invoice</span><strong>${escapeHtml(order.order_number)}</strong></div>
      <div class="meta-row"><span class="label">Date</span><span>${escapeHtml(order.created_at)}</span></div>
      <div class="meta-row"><span class="label">Staff</span><span>${escapeHtml(order.created_by_name || "Staff")}</span></div>
      <div class="meta-row"><span class="label">Channel</span><span>In-store POS</span></div>
    </section>

    <section class="section customer">
      <p><strong>${escapeHtml(order.name)}</strong></p>
      <p>${escapeHtml(order.phone)}</p>
      ${order.note ? `<p>Note: ${escapeHtml(order.note)}</p>` : ""}
    </section>

    <section class="section">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Item</th>
            <th class="num">Qty</th>
            <th class="money">Rate</th>
            <th class="money">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>

    <section class="totals">
      <div class="total-row"><span>Subtotal</span><span>${escapeHtml(formatPaisa(order.subtotal_paisa))}</span></div>
      ${order.delivery_paisa > 0 ? `<div class="total-row"><span>Delivery</span><span>${escapeHtml(formatPaisa(order.delivery_paisa))}</span></div>` : ""}
      ${order.discount_paisa > 0 ? `<div class="total-row"><span>Discount</span><span>-${escapeHtml(formatPaisa(order.discount_paisa))}</span></div>` : ""}
      <div class="total-row grand"><span>Total Paid</span><span>${escapeHtml(formatPaisa(order.total_paisa))}</span></div>
      <div class="paid">${escapeHtml(order.payment_status.toUpperCase())} - COUNTER SALE</div>
    </section>

    <footer class="footer">
      <p>Thank you for shopping with Zabir Boutiques.</p>
      <p>Exchange policy applies with original invoice.</p>
    </footer>
  </main>
  <script>
    window.addEventListener("load", () => {
      setTimeout(() => window.print(), 150);
    });
  </script>
</body>
</html>`;
}
