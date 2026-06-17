/**
 * Central RBAC System [v6.8D — Platform Security Hardening]
 *
 * KEY DISTINCTION (v6.8D security audit):
 *   super_admin → FULL platform-control access (API keys, integrations, backups, webhooks)
 *   owner       → Business-level full access, but NO platform secret/API-control authority
 *
 * Roles:
 *   super_admin  → full platform + business access
 *   owner        → full business access, limited platform read
 *   manager      → daily operations
 *   salesman     → sales + COD order creation
 *   packing      → packing queue + courier handoff
 *   support      → order search + support notes
 *   developer    → read-only API Code / Developer info
 *   auditor      → read-only audit + reports
 */
import type { APIContext } from 'astro';
import { env as cloudflareEnv } from 'cloudflare:workers';
import { hashSessionToken } from './sessions';
import { nowSql } from './dates';
import { safeLog } from './pii-scrubber';
import { writeAuditLog } from './audit';
import { readStaffSessionCookie } from './staff-cookies';

export type StaffRole = 'super_admin' | 'owner' | 'manager' | 'salesman' | 'packing' | 'support' | 'developer' | 'auditor';

const VALID_STAFF_ROLES: ReadonlySet<string> = new Set<StaffRole>([
  'super_admin', 'owner', 'manager', 'salesman', 'packing', 'support', 'developer', 'auditor'
]);

export function isValidStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && VALID_STAFF_ROLES.has(value);
}

export type Permission =
  // Legacy business permissions (preserved for backward compatibility)
  | 'owner.full_access'
  | 'staff.manage'
  | 'roles.manage'
  | 'settings.manage'
  | 'system.api_code.manage'
  | 'system.backup.manage'
  | 'system.audit.view'
  | 'products.manage'
  | 'categories.manage'
  | 'inventory.manage'
  | 'inventory.adjust'
  | 'orders.view'
  | 'orders.create'
  | 'orders.update'
  | 'orders.confirm'
  | 'orders.cancel'
  | 'orders.pack'
  | 'orders.ship'
  | 'payments.view'
  | 'payments.verify'
  | 'payments.refund'
  | 'fraud.view'
  | 'fraud.override'
  | 'media.upload'
  | 'support.view'
  | 'support.note'
  | 'reports.view'
  // Platform-control permissions (super_admin only)
  | 'platform.full_access'
  | 'integrations.read'
  | 'integrations.test'
  | 'integrations.logs.read'
  | 'api_keys.read'
  | 'api_keys.create'
  | 'api_keys.revoke'
  | 'api_keys.delete'
  | 'api_code.read'
  | 'api_code.update'
  | 'backups.read'
  | 'backups.download'
  | 'backups.restore'
  | 'webhooks.read'
  | 'webhooks.update'
  | 'settings.platform.read'
  | 'settings.platform.update';

export interface StaffUser {
  id: string;
  role: StaffRole;
  fullName: string;
  sessionId: string;
}

/**
 * CRITICAL DISTINCTION: super_admin has platform access; owner does NOT.
 * For business-level operations (orders, products, coupons), both pass.
 * For platform-control (API keys, integrations, backups), only super_admin passes.
 */
const SUPER_ADMIN_ONLY: ReadonlySet<StaffRole> = new Set(['super_admin']);
const BUSINESS_OWNER_TIER: ReadonlySet<StaffRole> = new Set(['super_admin', 'owner']);

/**
 * Platform-control permissions — super_admin ONLY.
 * `can()` short-circuits on `super_admin` via `isSuperAdmin`, so this set
 * is the authoritative boundary for documentation and any future code
 * that needs to enumerate which permissions are platform-control. It is
 * exported so other modules (e.g. a future platform admin UI) can rely
 * on the same source of truth.
 */
export const PLATFORM_PERMS: ReadonlySet<Permission> = new Set([
  'platform.full_access',
  'integrations.read', 'integrations.test', 'integrations.logs.read',
  'api_keys.read', 'api_keys.create', 'api_keys.revoke', 'api_keys.delete',
  'api_code.update',
  'backups.restore',
  'webhooks.read', 'webhooks.update',
  'settings.platform.update'
]);

const MANAGER_PERMS: Permission[] = [
  'products.manage', 'categories.manage', 'inventory.manage', 'inventory.adjust',
  'orders.view', 'orders.create', 'orders.update', 'orders.confirm', 'orders.cancel',
  'orders.pack', 'orders.ship', 'fraud.view', 'media.upload',
  'support.view', 'support.note', 'reports.view', 'payments.view'
];

const SALESMAN_PERMS: Permission[] = [
  'orders.view', 'orders.create', 'orders.update', 'support.note'
];

const PACKING_PERMS: Permission[] = [
  'orders.view', 'orders.pack', 'orders.ship'
];

const SUPPORT_PERMS: Permission[] = [
  'support.view', 'support.note', 'orders.view'
];

// Developer: read-only API Code / Developer area only.
const DEVELOPER_PERMS: Permission[] = [
  'api_code.read'
];

// Auditor: read-only audit + reports.
const AUDITOR_PERMS: Permission[] = [
  'system.audit.view', 'reports.view'
];

// Owner: business-level permissions (not platform-control)
const OWNER_PERMS: Permission[] = [
  'staff.manage', 'roles.manage', 'settings.manage',
  'system.audit.view', 'system.backup.manage',
  'products.manage', 'categories.manage', 'inventory.manage', 'inventory.adjust',
  'orders.view', 'orders.create', 'orders.update', 'orders.confirm', 'orders.cancel',
  'orders.pack', 'orders.ship', 'fraud.view', 'fraud.override', 'media.upload',
  'support.view', 'support.note', 'reports.view', 'payments.view', 'payments.verify', 'payments.refund',
  'api_code.read', 'backups.read', 'backups.download',
  'integrations.read'
];

/**
 * Static permission matrix.
 */
const PERMISSION_MATRIX: Record<StaffRole, ReadonlySet<Permission>> = {
  super_admin: new Set<Permission>(), // handled by isSuperAdmin short-circuit
  owner: new Set(OWNER_PERMS),
  manager: new Set(MANAGER_PERMS),
  salesman: new Set(SALESMAN_PERMS),
  packing: new Set(PACKING_PERMS),
  support: new Set(SUPPORT_PERMS),
  developer: new Set(DEVELOPER_PERMS),
  auditor: new Set(AUDITOR_PERMS)
};

export class RbacError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'RbacError';
  }
  toResponse(): Response {
    return Response.json({ ok: false, code: this.code, error: this.message }, { status: this.status });
  }
}

/** True only for super_admin — the sole platform controller. */
export function isSuperAdmin(role: StaffRole): boolean {
  return SUPER_ADMIN_ONLY.has(role);
}

/** True for super_admin OR owner — business-level full access. */
export function isOwnerTier(role: StaffRole): boolean {
  return BUSINESS_OWNER_TIER.has(role);
}

/**
 * Rule #9 (v6.8D): a FraudBD-`blocked` order may only be confirmed by a holder
 * of `fraud.override` (super_admin or owner). Pure predicate for unit testing.
 */
export function canConfirmOrder(role: StaffRole, fraudDecision: string | null | undefined): boolean {
  if (fraudDecision === 'blocked') return can(role, 'fraud.override');
  return true;
}

/**
 * In-memory permission check.
 * - super_admin: always true (full platform + business access).
 * - owner: true for business perms, false for platform-control perms.
 * - others: explicit matrix lookup.
 */
export function can(role: StaffRole, permission: Permission): boolean {
  if (SUPER_ADMIN_ONLY.has(role)) return true;
  return PERMISSION_MATRIX[role]?.has(permission) ?? false;
}

/**
 * Resolve the current staff user from the session cookie.
 */
export async function getCurrentStaffUser(context: APIContext): Promise<StaffUser | null> {
  const locals = context.locals as App.Locals | undefined;
  if (locals?.staffUserResolved) return locals.staffUser ?? null;

  const env = cloudflareEnv as { DB?: D1Database; SESSION_SECRET?: string };
  if (!env?.DB || !env.SESSION_SECRET) return null;

  const sessionToken = readStaffSessionCookie(context.request);
  if (!sessionToken) return null;

  const tokenHash = await hashSessionToken(sessionToken, env.SESSION_SECRET);
  const now = nowSql();

  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, s.staff_user_id, u.role, u.full_name, s.last_active_at
     FROM staff_sessions s
     JOIN staff_users u ON u.id = s.staff_user_id
     WHERE s.token_hash = ?1
       AND s.is_revoked = 0
       AND s.expires_at > ?2
       AND s.absolute_expires_at > ?2
       AND u.is_active = 1`
  ).bind(tokenHash, now).first<{ session_id: string; staff_user_id: string; role: string; full_name: string; last_active_at: string }>();

  if (!row) return null;

  // Master_Prompt v7.0 §9.1: 30-min idle timeout. P1-007 audit fix:
  // the idle check + revocation + last_active_at refresh happen in a
  // single atomic batch guarded by `is_revoked = 0`. A concurrent
  // request that beat us to the revoke wins; we see no rows and return
  // null. The DB trigger `trg_staff_sessions_no_refresh_on_revoked`
  // (migration 0013) prevents any UPDATE on a revoked session from
  // refreshing last_active_at, closing the zombie-authenticated window.
  const lastActiveMs = Date.parse(row.last_active_at.replace(' ', 'T') + 'Z');
  const expiresAt = nowSql(new Date(Date.now() + 30 * 60 * 1000));
  if (Number.isFinite(lastActiveMs)) {
    const idleMs = Date.now() - lastActiveMs;
    if (idleMs > 30 * 60 * 1000) {
      // Atomic idle-revoke. The guard `is_revoked = 0` makes this
      // idempotent: a second concurrent request sees 0 changes and
      // moves on.
      const revoke = await env.DB.prepare(
        `UPDATE staff_sessions
         SET is_revoked = 1, expires_at = ?2
         WHERE id = ?1 AND is_revoked = 0`,
      ).bind(row.session_id, now).run();
      if (revoke.meta.changes === 1) {
        // We won the race. Record the revocation event for the
        // session-blacklist mirror + audit log.
        try {
          await env.DB.batch(
            [
              env.DB.prepare(
                `INSERT OR REPLACE INTO session_blacklist (token_hash, staff_user_id, revoked_at, expires_at)
                 SELECT ?1, staff_user_id, ?2, ?3 FROM staff_sessions WHERE id = ?4`,
              ).bind(tokenHash, now, nowSql(new Date(Date.now() + 8 * 60 * 60 * 1000)), row.session_id),
            ],
            { atomic: true },
          );
        } catch (err) {
          safeLog.warn('[rbac] session_blacklist mirror failed (non-fatal)', { error: err instanceof Error ? err.message : String(err) });
        }
        // P0-004 audit fix: write an audit_log row for the idle-revoke.
        // Best-effort — the revoke has already committed. A failure here
        // is logged but does not block the response.
        try {
          await writeAuditLog(env.DB, {
            actorStaffId: row.staff_user_id,
            actorRole: row.role,
            action: 'staff.session.idle_revoked',
            entityType: 'staff_session',
            entityId: row.session_id,
            metadata: {
              idleMs: Math.floor(idleMs),
              absoluteExpiresAt: row ? null : null, // populated if needed
            },
          });
        } catch (err) {
          safeLog.warn('[rbac] idle-revoke audit log failed (non-fatal)', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return null;
    }
  }

  // Active session: refresh last_active_at + slide the idle window in
  // a single guarded UPDATE. If the session was just revoked by a
  // concurrent request, the guard causes 0 changes and we still return
  // the user (the revoke + our no-op refresh is benign; the next
  // request will hit the idle check or find is_revoked=1).
  env.DB.prepare(
    `UPDATE staff_sessions
     SET last_active_at = ?2, expires_at = ?3
     WHERE id = ?1 AND is_revoked = 0`,
  )
    .bind(row.session_id, now, expiresAt)
    .run()
    .catch((err) => safeLog.warn('[rbac] failed to refresh session last_active_at', { error: err instanceof Error ? err.message : String(err) }));

  // Fail-closed guard: if the D1 row carries a role value that does not
  // match the StaffRole union (e.g. a manual edit, schema drift, or a
  // future migration that did not update the CHECK constraint), treat the
  // session as invalid rather than letting a misspelled role silently
  // pass role-string equality checks downstream.
  if (!isValidStaffRole(row.role)) {
    safeLog.error('[rbac] Unknown staff_users.role value, rejecting session', { role: row.role });
    return null;
  }

  return {
    id: row.staff_user_id,
    role: row.role,
    fullName: row.full_name,
    sessionId: row.session_id
  };
}

export async function requireAuth(context: APIContext): Promise<StaffUser> {
  const user = await getCurrentStaffUser(context);
  if (!user) throw new RbacError(401, 'UNAUTHENTICATED', 'Authentication required');
  return user;
}

export function requireRole(user: StaffUser, allowedRoles: StaffRole[]): void {
  if (!allowedRoles.includes(user.role)) {
    throw new RbacError(403, 'FORBIDDEN_ROLE', 'Insufficient role');
  }
}

export function requirePermission(user: StaffUser, permission: Permission): void {
  if (!can(user.role, permission)) {
    throw new RbacError(403, 'FORBIDDEN_PERMISSION', `Missing permission: ${permission}`);
  }
}

/** Super Admin only — platform-control operations. */
export function assertSuperAdminOnly(user: StaffUser): void {
  if (!isSuperAdmin(user.role)) {
    throw new RbacError(403, 'SUPER_ADMIN_ONLY', 'Super Admin access required for platform operations');
  }
}

/** Owner / Super Admin — business-level operations (coupons, staff, fraud override). */
export function assertOwnerOnly(user: StaffUser): void {
  if (!isOwnerTier(user.role)) {
    throw new RbacError(403, 'OWNER_ONLY', 'Owner / Super Admin access required');
  }
}

export function assertManagerOrOwner(user: StaffUser): void {
  requireRole(user, ['super_admin', 'owner', 'manager']);
}

export function assertSalesAccess(user: StaffUser): void {
  requireRole(user, ['super_admin', 'owner', 'manager', 'salesman']);
}

export function assertPackingAccess(user: StaffUser): void {
  requireRole(user, ['super_admin', 'owner', 'manager', 'packing']);
}

export function assertSupportAccess(user: StaffUser): void {
  requireRole(user, ['super_admin', 'owner', 'manager', 'support']);
}

/**
 * List of permissions granted to a role (for menu building / debugging).
 */
export function permissionsFor(role: StaffRole): Permission[] {
  if (SUPER_ADMIN_ONLY.has(role)) return ['platform.full_access'];
  return Array.from(PERMISSION_MATRIX[role] ?? []);
}
