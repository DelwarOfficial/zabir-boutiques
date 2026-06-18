/**
 * GET /api/staff/invoices/[id] — Fetch a single invoice for the
 * print page (used by the staff dashboard's print modal).
 *
 * RBAC: requires `orders.view` (any staff role).
 */
import type { APIContext } from "astro";
import { getEnv } from "../../../../../lib/env";
import { requireAuth, requirePermission, RbacError } from "../../../../../lib/rbac";
import { loadInvoiceForPrint } from "../../../../../lib/invoices";

export async function GET(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const id = context.params.id;
  if (!id) {
    return Response.json({ ok: false, code: "MISSING_ID" }, { status: 400 });
  }

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
  if (!data) {
    return Response.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  }
  return Response.json({ ok: true, ...data });
}
