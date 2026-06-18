/**
 * POST /api/staff/returns [Master_Prompt v7.0 §7.2]
 * Create a return request. RBAC: orders.update.
 *
 * Body: { order_id, items: [{ variant_id, quantity }], reason }
 */
import type { APIContext } from "astro";
import { getEnv } from "../../../../lib/env";
import { nowSql } from "../../../../lib/dates";
import { requireAuth, requirePermission, RbacError } from "../../../../lib/rbac";
import { writeAuditLog, clientIp, userAgent } from "../../../../lib/audit";

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, "orders.update");
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  const body = (await context.request.json().catch(() => ({}))) as {
    order_id?: string;
    items?: Array<{ variant_id: string; quantity: number }>;
    reason?: string;
  };
  if (!body.order_id || !body.items?.length || !body.reason) {
    return Response.json({ ok: false, code: "INVALID_BODY" }, { status: 400 });
  }
  const id = crypto.randomUUID();
  const now = nowSql();
  await env.DB
    .prepare(
      `INSERT INTO return_requests (id, order_id, items_json, reason, status, refund_amount_paisa, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'pending', 0, ?5, ?5)`,
    )
    .bind(id, body.order_id, JSON.stringify(body.items), body.reason, now)
    .run();
  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: "return.create",
    entityType: "return_request",
    entityId: id,
    metadata: { order_id: body.order_id, item_count: body.items.length },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  });
  return Response.json({ ok: true, id }, { status: 201 });
}
