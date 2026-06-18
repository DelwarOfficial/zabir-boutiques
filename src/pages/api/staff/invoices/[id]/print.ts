/**
 * GET /api/staff/invoices/[id]/print — 80mm thermal receipt print page.
 *
 * Renders a self-contained HTML page sized for an 80mm thermal
 * printer. The page auto-prints on load (window.print) and the
 * cashier can also click "Print" to retry.
 *
 * Bangladesh NBR SRO 198/Law/2015 fields (POS_BIN, POS_TIN) are
 * surfaced from the env when configured. Without them the receipt
 * is still printable, but the legal footer is missing — the operator
 * MUST set them via `wrangler secret put` before going live.
 *
 * RBAC: requires `orders.view` (any staff role).
 */
import type { APIContext } from "astro";
import { getEnv } from "../../../../../lib/env";
import { requireAuth, requirePermission, RbacError } from "../../../../../lib/rbac";
import { loadInvoiceForPrint } from "../../../../../lib/invoices";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function fmtTaka(paisa: number): string {
  return `৳${Math.floor(paisa / 100)}`;
}

function methodLabel(m: string): string {
  switch (m) {
    case "cash": return "Cash";
    case "card": return "Card";
    case "bkash": return "bKash";
    case "nagad": return "Nagad";
    case "rocket": return "Rocket";
    case "bank_transfer": return "Bank";
    case "other": return "Other";
    default: return m;
  }
}

export async function GET(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const id = context.params.id;
  if (!id) return Response.json({ ok: false, code: "MISSING_ID" }, { status: 400 });

  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, "orders.view");
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }
  void user;

  const data = await loadInvoiceForPrint(env.DB, id);
  if (!data) return Response.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });

  const { invoice, items, payments } = data;
  const isVoided = invoice.status === "voided";
  const siteName = (env as unknown as { PUBLIC_SITE_NAME?: string }).PUBLIC_SITE_NAME ?? "Zabir Boutiques";
  const siteUrl = (env as unknown as { PUBLIC_SITE_URL?: string }).PUBLIC_SITE_URL ?? "";
  const bin = (env as unknown as { POS_BIN?: string }).POS_BIN ?? null;
  const tin = (env as unknown as { POS_TIN?: string }).POS_TIN ?? null;

  // 80mm thermal printers use ~32 char columns. We render with a
  // 30-char virtual width and a `font-size: 12px` monospace receipt
  // font. The CSS @page rule sets the paper size.
  const lines = (text: string, width = 30) => {
    // Word-wrap a string to `width` chars per line. Thermal printers
    // don't auto-wrap, so we do it client-side.
    const out: string[] = [];
    const words = text.split(/\s+/);
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > width) {
        if (cur) out.push(cur);
        cur = w;
      } else {
        cur = cur ? cur + " " + w : w;
      }
    }
    if (cur) out.push(cur);
    return out.join("<br>");
  };

  const itemsHtml = items
    .map((it) => {
      const name = lines(escapeHtml(it.product_name + " — " + it.variant_label));
      const skuLine = `<div class="meta">${escapeHtml(it.sku)}</div>`;
      const lineRow = `
        <div class="line">
          <div>${name}${skuLine}</div>
          <div class="row">
            <span>${it.quantity} × ${fmtTaka(it.unit_price_paisa)}</span>
            <span>${fmtTaka(it.total_price_paisa)}</span>
          </div>
        </div>`;
      return lineRow;
    })
    .join("");

  const paymentsHtml = payments
    .map((p) => `
        <div class="row">
          <span>${escapeHtml(methodLabel(p.method))}${p.reference ? ` <span class="meta">${escapeHtml(p.reference)}</span>` : ""}</span>
          <span>${fmtTaka(p.amount_paisa)}</span>
        </div>`)
    .join("");

  const binLine = bin
    ? `<div class="center meta">BIN: ${escapeHtml(bin)}</div>`
    : `<div class="center meta warn">BIN not configured — set POS_BIN via wrangler secret put</div>`;
  const tinLine = tin
    ? `<div class="center meta">TIN: ${escapeHtml(tin)}</div>`
    : `<div class="center meta warn">TIN not configured — set POS_TIN via wrangler secret put</div>`;

  const voidStamp = isVoided
    ? `<div class="center void-stamp">*** VOIDED ***</div>
       <div class="center meta">${escapeHtml(invoice.voided_reason ?? "voided")}</div>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Receipt ${escapeHtml(invoice.receipt_no)}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: ui-monospace, "Cascadia Mono", "Source Code Pro", Consolas, monospace;
    font-size: 12px;
    line-height: 1.35;
    width: 72mm;
    color: #000;
    background: #fff;
  }
  .center { text-align: center; }
  .meta { font-size: 10px; color: #444; }
  .warn { color: #b00; }
  .sep { border-top: 1px dashed #000; margin: 4px 0; }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 4px;
  }
  .line { margin: 2px 0; }
  .total-row { font-weight: 700; font-size: 14px; }
  .actions {
    margin-top: 8px;
    display: flex;
    gap: 6px;
    justify-content: center;
  }
  .actions button {
    font-family: inherit;
    font-size: 12px;
    padding: 4px 10px;
    border: 1px solid #000;
    background: #fff;
    cursor: pointer;
  }
  .void-stamp {
    font-size: 18px;
    font-weight: 700;
    color: #b00;
    margin: 6px 0;
    letter-spacing: 2px;
  }
  @media print {
    .actions { display: none; }
  }
</style>
</head>
<body>
  <div class="center" style="font-weight:700; font-size:14px;">${escapeHtml(siteName)}</div>
  <div class="center meta">${escapeHtml(siteUrl.replace(/^https?:\/\//, ""))}</div>
  <div class="center meta">Wari, Dhaka — +880 1985-516000</div>
  <div class="sep"></div>
  <div class="row"><span>Receipt</span><span>${escapeHtml(invoice.receipt_no)}</span></div>
  <div class="row"><span>Date</span><span>${escapeHtml((invoice.paid_at ?? invoice.created_at).slice(0, 19))}</span></div>
  <div class="row"><span>Cashier</span><span>${escapeHtml(invoice.cashier_name)}</span></div>
  ${invoice.customer_name ? `<div class="row"><span>Customer</span><span>${escapeHtml(invoice.customer_name)}</span></div>` : ""}
  ${invoice.customer_phone ? `<div class="row"><span>Phone</span><span>${escapeHtml(invoice.customer_phone)}</span></div>` : ""}
  <div class="sep"></div>
  ${itemsHtml}
  <div class="sep"></div>
  <div class="row"><span>Subtotal</span><span>${fmtTaka(invoice.subtotal_paisa)}</span></div>
  ${invoice.discount_paisa > 0 ? `<div class="row"><span>Discount</span><span>− ${fmtTaka(invoice.discount_paisa)}</span></div>` : ""}
  ${invoice.vat_paisa > 0 ? `<div class="row"><span>VAT</span><span>${fmtTaka(invoice.vat_paisa)}</span></div>` : ""}
  <div class="row total-row"><span>TOTAL</span><span>${fmtTaka(invoice.total_paisa)}</span></div>
  <div class="sep"></div>
  ${paymentsHtml}
  <div class="row"><span>Paid</span><span>${fmtTaka(invoice.amount_paid_paisa)}</span></div>
  ${invoice.change_due_paisa > 0 ? `<div class="row"><span>Change</span><span>${fmtTaka(invoice.change_due_paisa)}</span></div>` : ""}
  <div class="sep"></div>
  ${binLine}
  ${tinLine}
  ${voidStamp}
  <div class="center meta" style="margin-top:6px;">Thank you for shopping with us.</div>
  <div class="center meta">Keep this receipt for any return or exchange.</div>
  <div class="actions">
    <button onclick="window.print()">Print</button>
    <button onclick="window.close()">Close</button>
  </div>
  <script>
    // Auto-print once the page is fully loaded. The cashier can
    // re-trigger via the "Print" button if the first attempt is
    // cancelled (printer out of paper, dialog dismissed, etc.).
    window.addEventListener("load", function () {
      setTimeout(function () { try { window.print(); } catch (e) {} }, 300);
    });
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="receipt-${invoice.receipt_no}.html"`,
    },
  });
}
