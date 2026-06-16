/**
 * POST /api/staff/returns/{id}/reject [Master_Prompt v7.0 §7.2]
 * Reject a return. Order remains in its current state.
 * RBAC: orders.update.
 */
export const prerender = false;

import type { APIContext } from "astro";
import { getEnv } from "../../../../../lib/env";
import { nowSql } from "../../../../../lib/dates";
import { requireAuth, requirePermission, RbacError } from "../../../../../lib/rbac";
import { writeAuditLog, clientIp, userAgent } from "../../../../../lib/audit";

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, "orders.update");
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err instanceof Error ? err : new Error(String(err));
  }
  const id = context.params.id;
  if (!id) return Response.json({ ok: false, code: "MISSING_ID" }, { status: 400 });

  const now = nowSql();
  const result = await env.DB
    .prepare("UPDATE return_requests SET status = 'rejected', reviewed_by = ?2, updated_at = ?3 WHERE id = ?1 AND status = 'pending'")
    .bind(id, user.id, now)
    .run();
  if (result.meta.changes !== 1) return Response.json({ ok: false, code: "NOT_FOUND_OR_RESOLVED" }, { status: 404 });
  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: "return.reject",
    entityType: "return_request",
    entityId: id,
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  });
  return Response.json({ ok: true });
}
