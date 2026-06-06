/**
 * Audit Logging [v6.8A]
 * Every staff/system mutation writes an audit_log row.
 * Sensitive raw payloads must be summarized; never store secrets.
 */
import { nowSql } from './dates';

export interface AuditEntry {
  actorStaffId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export function clientIp(request: Request): string | null {
  return (
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    null
  );
}

export function userAgent(request: Request): string | null {
  const ua = request.headers.get('User-Agent');
  if (!ua) return null;
  return ua.slice(0, 512);
}

/**
 * Write a single audit_log row. Best-effort: a logging failure must never
 * crash the parent mutation, but the error is surfaced to console.
 */
export async function writeAuditLog(db: D1Database, entry: AuditEntry): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO audit_log (
        id, actor_staff_id, actor_role, action, entity_type, entity_id,
        metadata_json, ip_address, user_agent, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
    ).bind(
      crypto.randomUUID(),
      entry.actorStaffId,
      entry.actorRole,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.metadata != null ? JSON.stringify(entry.metadata) : null,
      entry.ipAddress ?? null,
      entry.userAgent ?? null,
      nowSql()
    ).run();
  } catch (err) {
    console.error('[audit] write failed:', err);
  }
}
