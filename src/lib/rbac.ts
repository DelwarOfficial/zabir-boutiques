/**
 * Central RBAC System [v6.8A]
 *
 * - Server-side enforcement only. Directory route splitting / menu hiding is NOT authorization.
 * - Static in-memory permission matrix for MVP (dynamic permission editing deferred, Owner-only later).
 * - Free-tier-safe auth path: ONE indexed joined session+user lookup, then in-memory matrix check.
 *
 * Roles (5 business roles + super_admin alias for owner-tier):
 *   super_admin / owner  → full system access
 *   manager              → daily operations, no owner-only system tools
 *   salesman             → sales dashboard + COD order creation
 *   packing              → packing queue + courier handoff
 *   support              → order search + support notes
 */
import type { APIContext } from 'astro';
import { hashSessionToken } from './sessions';
import { nowSql } from './dates';

export type StaffRole = 'super_admin' | 'owner' | 'manager' | 'salesman' | 'packing' | 'support';

export type Permission =
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
  | 'reports.view';

export interface StaffUser {
  id: string;
  role: StaffRole;
  fullName: string;
  sessionId: string;
}

const OWNER_TIER: ReadonlySet<StaffRole> = new Set(['super_admin', 'owner']);

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

/**
 * Static permission matrix. Owner-tier gets every permission implicitly via `can()`.
 */
const PERMISSION_MATRIX: Record<StaffRole, ReadonlySet<Permission>> = {
  super_admin: new Set<Permission>(), // handled by OWNER_TIER short-circuit
  owner: new Set<Permission>(),       // handled by OWNER_TIER short-circuit
  manager: new Set(MANAGER_PERMS),
  salesman: new Set(SALESMAN_PERMS),
  packing: new Set(PACKING_PERMS),
  support: new Set(SUPPORT_PERMS)
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

export function isOwnerTier(role: StaffRole): boolean {
  return OWNER_TIER.has(role);
}

/**
 * In-memory permission check. Owner / Super Admin always allowed.
 */
export function can(role: StaffRole, permission: Permission): boolean {
  if (OWNER_TIER.has(role)) return true;
  return PERMISSION_MATRIX[role]?.has(permission) ?? false;
}

function readSessionCookie(request: Request): string | null {
  const cookie = request.headers.get('Cookie') ?? '';
  const match = cookie.match(new RegExp('(?:^|;\\s*)session=([^;]+)'));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Resolve the current staff user from the session cookie.
 * Free-tier-safe: single joined query against the partial index
 * idx_sessions_token_active (token_hash WHERE is_revoked = 0).
 * Returns null when unauthenticated / revoked / expired / inactive.
 */
export async function getCurrentStaffUser(context: APIContext): Promise<StaffUser | null> {
  const runtime = (context.locals as { runtime?: { env?: { DB?: D1Database; SESSION_SECRET?: string } } }).runtime;
  const env = runtime?.env;
  if (!env?.DB || !env.SESSION_SECRET) return null;

  const sessionToken = readSessionCookie(context.request);
  if (!sessionToken) return null;

  const tokenHash = await hashSessionToken(sessionToken, env.SESSION_SECRET);
  const now = nowSql();

  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, s.staff_user_id, u.role, u.full_name
     FROM staff_sessions s
     JOIN staff_users u ON u.id = s.staff_user_id
     WHERE s.token_hash = ?1
       AND s.is_revoked = 0
       AND s.expires_at > ?2
       AND s.absolute_expires_at > ?2
       AND u.is_active = 1`
  ).bind(tokenHash, now).first<{ session_id: string; staff_user_id: string; role: string; full_name: string }>();

  if (!row) return null;

  return {
    id: row.staff_user_id,
    role: row.role as StaffRole,
    fullName: row.full_name,
    sessionId: row.session_id
  };
}

/**
 * Require an authenticated staff user or throw RbacError(401).
 */
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

/** Owner / Super Admin only — used for all developer/config/secret/backup areas. */
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
 * Owner-tier returns the sentinel ['owner.full_access'].
 */
export function permissionsFor(role: StaffRole): Permission[] {
  if (OWNER_TIER.has(role)) return ['owner.full_access'];
  return Array.from(PERMISSION_MATRIX[role] ?? []);
}
