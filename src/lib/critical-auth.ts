import type { APIContext } from 'astro';
import { getEnv } from './env';
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
  let db: D1Database;
  try {
    const env = getEnv(context);
    db = env.DB;
  } catch {
    throw new CriticalAuthError(500, 'DB_UNAVAILABLE', 'Database unavailable');
  }

  const row = await db.prepare(
    `SELECT step_up_at FROM staff_sessions
     WHERE id = ?1 AND staff_user_id = ?2 AND is_revoked = 0`
  ).bind(user.sessionId, user.id).first<{ step_up_at: string | null }>();

  if (!row) throw new CriticalAuthError(401, 'SESSION_NOT_FOUND', 'Session is no longer active');

  if (!row.step_up_at) {
    throw new CriticalAuthError(403, 'STEP_UP_REQUIRED', 'Recent staff authentication required');
  }

  const stepUpAt = Date.parse(`${row.step_up_at.replace(' ', 'T')}Z`);
  if (!Number.isFinite(stepUpAt)) {
    throw new CriticalAuthError(403, 'STEP_UP_REQUIRED', 'Recent staff authentication required');
  }

  const ageSeconds = (Date.now() - stepUpAt) / 1000;
  if (ageSeconds > STEP_UP_WINDOW_SECONDS) {
    throw new CriticalAuthError(403, 'STEP_UP_REQUIRED', 'Recent staff authentication required for this critical operation');
  }
}
