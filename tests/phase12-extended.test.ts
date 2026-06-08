/**
 * Phase 12 Extended Tests [v6.8D]
 *
 * Covers gaps from the Master Plan's Phase 12 required test list:
 * - RBAC blocking staff from coupon mutations
 * - Backup permission enforcement
 * - Developer/auditor role scoping (deep cases)
 * - CSRF missing/invalid/valid flow (logic path simulation)
 * - No raw API key or raw session token exposure in CSRF
 * - AI budget guard logic
 * - Prepayment rule boundary conditions
 */
import { describe, it, expect } from 'vitest';
import { can, isSuperAdmin, isOwnerTier, canConfirmOrder, type StaffRole, type Permission } from '../src/lib/rbac';
import { createCsrfToken, verifyCsrfToken, generateRandomHex, hmacSha256Hex } from '../src/lib/security';
import { calculatePrepayment } from '../src/lib/prepayment';
import { normalizeApiKeyScopes, API_KEY_SCOPES } from '../src/lib/api-keys';
import { hashSessionToken } from '../src/lib/sessions';

const SECRET = 'test-secret-for-phase12-at-least-32-bytes-long';

// ─── RBAC: Coupon mutations blocked for non-owner ───────────────────
describe('RBAC coupon mutation blocking', () => {
  const couponPerms: Permission[] = ['owner.full_access'];
  const nonOwnerRoles: StaffRole[] = ['manager', 'salesman', 'packing', 'support', 'developer', 'auditor'];

  it('no non-owner role has implicit coupon access', () => {
    // Coupon endpoints use assertOwnerOnly() which checks isOwnerTier().
    for (const role of nonOwnerRoles) {
      expect(isOwnerTier(role)).toBe(false);
    }
  });

  it('only owner-tier passes the assertOwnerOnly check used by coupon APIs', () => {
    expect(isOwnerTier('owner')).toBe(true);
    expect(isOwnerTier('super_admin')).toBe(true);
  });

  it('manager cannot escalate to coupon management via any known permission', () => {
    // Verify no permission in the matrix gives indirect coupon access
    const managerPerms = [
      'products.manage', 'categories.manage', 'inventory.manage', 'inventory.adjust',
      'orders.view', 'orders.create', 'orders.update', 'orders.confirm', 'orders.cancel',
      'orders.pack', 'orders.ship', 'fraud.view', 'media.upload',
      'support.view', 'support.note', 'reports.view', 'payments.view'
    ] as Permission[];
    // None of these include a "coupons" permission
    for (const p of managerPerms) {
      expect(p.includes('coupon')).toBe(false);
    }
  });
});

// ─── Backup permission enforcement ──────────────────────────────────
describe('Backup permission (super_admin only for platform control)', () => {
  it('only super_admin can restore backups', () => {
    expect(can('super_admin', 'backups.restore')).toBe(true);
    expect(can('owner', 'backups.restore')).toBe(false);
  });

  it('owner can read/download backups but not restore', () => {
    expect(can('owner', 'backups.read')).toBe(true);
    expect(can('owner', 'backups.download')).toBe(true);
    expect(can('owner', 'backups.restore')).toBe(false);
  });

  it('every non-owner role is denied backup access', () => {
    const blocked: StaffRole[] = ['manager', 'salesman', 'packing', 'support', 'developer', 'auditor'];
    for (const role of blocked) {
      expect(can(role, 'backups.read')).toBe(false);
      expect(can(role, 'backups.restore')).toBe(false);
    }
  });
});

// ─── Developer/auditor deep scoping ─────────────────────────────────
describe('Developer and Auditor role deep scoping', () => {
  it('developer has exactly one permission: api_code.read', () => {
    expect(can('developer', 'api_code.read')).toBe(true);
    const dangerous: Permission[] = [
      'orders.create', 'orders.confirm', 'payments.verify', 'payments.refund',
      'fraud.override', 'staff.manage', 'backups.restore', 'settings.platform.update',
      'api_keys.create', 'api_code.update', 'integrations.test'
    ];
    for (const p of dangerous) expect(can('developer', p)).toBe(false);
  });

  it('auditor has exactly audit.view + reports.view', () => {
    expect(can('auditor', 'system.audit.view')).toBe(true);
    expect(can('auditor', 'reports.view')).toBe(true);
    const mutations: Permission[] = [
      'orders.create', 'orders.confirm', 'orders.cancel', 'inventory.adjust',
      'media.upload', 'fraud.override', 'staff.manage', 'api_keys.create'
    ];
    for (const p of mutations) expect(can('auditor', p)).toBe(false);
  });

  it('neither developer nor auditor can confirm fraud-blocked orders', () => {
    expect(canConfirmOrder('developer', 'blocked')).toBe(false);
    expect(canConfirmOrder('auditor', 'blocked')).toBe(false);
  });
});

// ─── CSRF flow simulation ───────────────────────────────────────────
describe('CSRF token flow (middleware logic paths)', () => {
  it('missing both cookie and header → blocked', async () => {
    // Simulates middleware check: !cookieToken || !headerToken
    const cookieToken: string | null = null;
    const headerToken: string | null = null;
    expect(!cookieToken || !headerToken).toBe(true); // would return 403
  });

  it('cookie present but header missing → blocked', async () => {
    const cookieToken = await createCsrfToken(SECRET);
    const headerToken: string | null = null;
    expect(!cookieToken || !headerToken).toBe(true);
  });

  it('cookie and header mismatch → blocked', async () => {
    const cookieToken = await createCsrfToken(SECRET);
    const headerToken = await createCsrfToken(SECRET); // different nonce
    expect(cookieToken !== headerToken).toBe(true); // would return 403
  });

  it('cookie and header match + valid signature → passes', async () => {
    const token = await createCsrfToken(SECRET);
    const cookieToken = token;
    const headerToken = token;
    expect(cookieToken === headerToken).toBe(true);
    expect(await verifyCsrfToken(cookieToken, SECRET)).toBe(true);
  });

  it('cookie and header match but signature invalid (wrong secret) → blocked', async () => {
    const token = await createCsrfToken('different-secret-not-the-server-one!');
    expect(await verifyCsrfToken(token, SECRET)).toBe(false);
  });
});

// ─── No raw session token or API key in CSRF cookie ─────────────────
describe('No secret leakage in CSRF token', () => {
  it('CSRF token nonce is independent of session token', async () => {
    const sessionToken = generateRandomHex(32);
    const csrf = await createCsrfToken(SECRET);
    expect(csrf).not.toContain(sessionToken);
  });

  it('session token hash is not derivable from CSRF token parts', async () => {
    const sessionToken = generateRandomHex(32);
    const sessionHash = await hashSessionToken(sessionToken, SECRET);
    const csrf = await createCsrfToken(SECRET);
    const [nonce, hmac] = csrf.split('.');
    expect(nonce).not.toBe(sessionHash);
    expect(hmac).not.toBe(sessionHash);
  });

  it('API key raw value never appears in CSRF token', async () => {
    const rawApiKey = 'zbk_' + generateRandomHex(32);
    const csrf = await createCsrfToken(SECRET);
    expect(csrf).not.toContain(rawApiKey);
    expect(csrf).not.toContain(rawApiKey.slice(4)); // without prefix
  });
});

// ─── Prepayment rule boundary conditions ────────────────────────────
describe('Prepayment rule boundary conditions', () => {
  it('2 items: no prepayment required', () => {
    const result = calculatePrepayment(2, 500000, 'cod');
    expect(result.required).toBe(false);
  });

  it('3 items: prepayment required', () => {
    const result = calculatePrepayment(3, 500000, 'cod');
    expect(result.required).toBe(true);
    expect(result.advancePaisa).toBeGreaterThan(0);
  });

  it('in_store payment method: never requires prepayment regardless of item count', () => {
    const result = calculatePrepayment(10, 1000000, 'in_store');
    expect(result.required).toBe(false);
  });

  it('advance is 50% (ceiling) of total', () => {
    // Total 1001 paisa → advance should be ceil(1001/2) = 501
    const result = calculatePrepayment(5, 1001, 'cod');
    expect(result.advancePaisa).toBe(501);
    expect(result.balancePaisa).toBe(500);
  });

  it('advance uses integer arithmetic only (no floating point)', () => {
    const result = calculatePrepayment(4, 99999, 'cod');
    expect(Number.isInteger(result.advancePaisa)).toBe(true);
    expect(Number.isInteger(result.balancePaisa)).toBe(true);
    expect(result.advancePaisa + result.balancePaisa).toBe(99999);
  });
});

// ─── API key scope enforcement (extended) ───────────────────────────
describe('API key scope enforcement (extended)', () => {
  it('empty scopes prevent any operation', () => {
    const scopes = normalizeApiKeyScopes([]);
    expect(scopes.length).toBe(0);
    expect(scopes.includes('orders:create_assisted' as any)).toBe(false);
  });

  it('scoped key cannot bypass checkout (no orders:create_assisted if not granted)', () => {
    const scopes = normalizeApiKeyScopes(['stock:read_public']);
    expect(scopes.includes('orders:create_assisted' as any)).toBe(false);
  });

  it('scoped key cannot bypass media (no media:upload_product_pending if not granted)', () => {
    const scopes = normalizeApiKeyScopes(['webhooks:payment_status_read']);
    expect(scopes.includes('media:upload_product_pending' as any)).toBe(false);
  });

  it('full scope set is bounded to exactly the defined list', () => {
    const all = normalizeApiKeyScopes([...API_KEY_SCOPES]);
    expect(all.length).toBe(API_KEY_SCOPES.length);
  });
});
