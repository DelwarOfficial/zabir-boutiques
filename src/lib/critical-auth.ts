import type { APIContext } from 'astro';
import { env as cloudflareEnv } from 'cloudflare:workers';
import { nowSql } from './dates';
import type { StaffUser } from './rbac';

const STEP_UP_WINDOW_SECONDS = 10 * 60;

export class CriticalAuthError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'CriticalAuthError';
  }

  toResponse(): Response {
    return Response.json({ ok: false, code: this.code, error: this.message }, { status: this.status });
  }
}

export async function requireRecentStaffSession(context: APIContext, user: StaffUser): Promise<void> {
  void context;
  const env = cloudflareEnv as { DB?: D1Database };
  if (!env.DB) throw new CriticalAuthError(500, 'DB_UNAVAILABLE', 'Database unavailable');

  const row = await env.DB.prepare(
    `SELECT last_active_at FROM staff_sessions
     WHERE id = ?1 AND staff_user_id = ?2 AND is_revoked = 0`
  ).bind(user.sessionId, user.id).first<{ last_active_at: string }>();

  if (!row) throw new CriticalAuthError(401, 'SESSION_NOT_FOUND', 'Session is no longer active');

  const lastActive = Date.parse(`${row.last_active_at.replace(' ', 'T')}Z`);
  if (!Number.isFinite(lastActive)) {
    throw new CriticalAuthError(403, 'STEP_UP_REQUIRED', 'Recent staff authentication required');
  }

  const ageSeconds = (Date.now() - lastActive) / 1000;
  if (ageSeconds > STEP_UP_WINDOW_SECONDS) {
    throw new CriticalAuthError(403, 'STEP_UP_REQUIRED', 'Recent staff authentication required for this critical operation');
  }

  await env.DB.prepare(
    `UPDATE staff_sessions SET last_active_at = ?1 WHERE id = ?2`
  ).bind(nowSql(), user.sessionId).run();
}
