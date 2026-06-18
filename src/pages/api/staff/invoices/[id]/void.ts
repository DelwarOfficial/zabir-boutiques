/**
 * POST /api/staff/invoices/[id]/void — Void a paid invoice.
 *
 * Restores stock and writes a voided_reason. RBAC: requires
 * `orders.cancel` (owner / super_admin / manager). Salesman cannot
 * void — that's a manager's call.
 */
import type { APIContext } from "astro";
import { getEnv } from "../../../../../lib/env";
import { nowSql } from "../../../../../lib/dates";
import { requireAuth, requirePermission, RbacError } from "../../../../../lib/rbac";
import { voidInvoice } from "../../../../../lib/invoices";
import { writeAuditLog, clientIp, userAgent } from "../../../../../lib/audit";

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const id = context.params.id;
  if (!id) return Response.json({ ok: false, code: "MISSING_ID" }, { status: 400 });

  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, "orders.cancel");
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  let body: { reason?: string };
  try {
    body = (await context.request.json()) as { reason?: string };
  } catch {
    return Response.json({ ok: false, code: "INVALID_JSON" }, { status: 400 });
  }

  const result = await voidInvoice(env, id, user.id, body.reason ?? "", nowSql());
  if (!result.ok) {
    const statusMap: Record<string, number> = {
      NOT_FOUND: 404,
      ALREADY_VOIDED: 409,
      INVALID_REASON: 400,
    };
    return Response.json(
      { ok: false, code: result.code, message: codeMessage(result.code) },
      { status: statusMap[result.code] ?? 500 },
    );
  }

  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: "invoice.void",
    entityType: "invoice",
    entityId: id,
    metadata: { reason: body.reason },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  });

  return Response.json({ ok: true });
}

function codeMessage(code: string): string {
  switch (code) {
    case "NOT_FOUND":
      return "Invoice not found.";
    case "ALREADY_VOIDED":
      return "Invoice is already voided or in a non-cancellable state.";
    case "INVALID_REASON":
      return "Reason is required (5-500 characters).";
    default:
      return "Void failed.";
  }
}
