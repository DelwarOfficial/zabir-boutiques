/**
 * GET /api/staff/orders/:id/invoice - POS invoice print view.
 *
 * Staff-only endpoint for walk-in shop sales created from the Staff Dashboard.
 * E-commerce customers do not get this route; it requires staff auth and the
 * order must be an in-store POS order.
 */
export const prerender = false;

import type { APIContext } from "astro";
import { getEnv } from "../../../../../lib/env";
import { requireAuth, requirePermission, RbacError } from "../../../../../lib/rbac";
import {
  renderStaffPosInvoiceHtml,
  type StaffPosInvoiceItem,
  type StaffPosInvoiceOrder
} from "../../../../../lib/staff-pos-invoice";

export async function GET(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const orderId = context.params.id;

  if (!orderId) return Response.json({ ok: false, error: "Missing order ID" }, { status: 400 });

  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, "orders.view");
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  const order = await env.DB.prepare(
    `SELECT o.id, o.order_number, o.name, o.phone, o.address, o.note,
            o.subtotal_paisa, o.delivery_paisa, o.discount_paisa, o.total_paisa,
            o.payment_method, o.payment_status, o.status, o.order_channel,
            o.created_at, s.full_name AS created_by_name
     FROM orders o
     LEFT JOIN staff_users s ON s.id = o.created_by
     WHERE o.id = ?1`
  ).bind(orderId).first<StaffPosInvoiceOrder>();

  if (!order) return Response.json({ ok: false, error: "Order not found" }, { status: 404 });

  if (order.order_channel !== "in_store" || order.payment_method !== "in_store") {
    return Response.json({
      ok: false,
      code: "NOT_POS_ORDER",
      error: "POS invoices are only available for in-store staff sales."
    }, { status: 409 });
  }

  const items = await env.DB.prepare(
    `SELECT product_name, variant_label, quantity, unit_price_paisa, total_price_paisa
     FROM order_items
     WHERE order_id = ?1
     ORDER BY created_at`
  ).bind(orderId).all<StaffPosInvoiceItem>();

  const html = renderStaffPosInvoiceHtml(order, items.results ?? []);

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="pos-invoice-${order.order_number}.html"`,
      "Cache-Control": "no-store"
    }
  });
}
