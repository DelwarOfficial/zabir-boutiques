/**
 * Staff RBAC [v6.8A]
 * Directory-level route splitting is not authorization;
 * every SSR page, API route, and Astro action must enforce server-side RBAC.
 */

export type StaffRole = 'super_admin' | 'owner' | 'manager' | 'moderator' | 'outlet_staff' | 'support_agent' | 'viewer';

const ROLE_HIERARCHY: Record<StaffRole, number> = {
  super_admin: 100,
  owner: 90,
  manager: 80,
  moderator: 60,
  outlet_staff: 40,
  support_agent: 20,
  viewer: 10
};

export function hasPermission(userRole: StaffRole, requiredRole: StaffRole): boolean {
  return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[requiredRole] ?? 999);
}

export function requireRole(userRole: StaffRole | undefined, requiredRole: StaffRole): void {
  if (!userRole || !hasPermission(userRole, requiredRole)) {
    throw new Error(`Forbidden: requires ${requiredRole} or higher`);
  }
}
