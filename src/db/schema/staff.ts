import { sqliteTable, text, integer, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';

export const staffUsers = sqliteTable('staff_users', {
  id: text('id').primaryKey(),
  email: text('email').unique(),
  phone: text('phone').unique(),
  passwordHash: text('password_hash').notNull(),
  passwordSalt: text('password_salt'),
  fullName: text('full_name').notNull(),
  role: text('role', { enum: ['super_admin', 'owner', 'manager', 'salesman', 'packing', 'support', 'developer', 'auditor'] }).notNull().default('support'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  lastLoginAt: text('last_login_at'),
  totpSecret: text('totp_secret'),
  totpEnrolledAt: text('totp_enrolled_at'),
  totpRequired: integer('totp_required', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const staffSessions = sqliteTable('staff_sessions', {
  id: text('id').primaryKey(),
  staffUserId: text('staff_user_id').notNull().references(() => staffUsers.id, { onDelete: 'restrict' }),
  tokenHash: text('token_hash').notNull().unique(),
  isRevoked: integer('is_revoked', { mode: 'boolean' }).notNull().default(false),
  expiresAt: text('expires_at').notNull(),
  absoluteExpiresAt: text('absolute_expires_at').notNull(),
  lastActiveAt: text('last_active_at').notNull(),
  stepUpAt: text('step_up_at'),
  createdAt: text('created_at').notNull(),
});

export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('display_name').notNull(),
  description: text('description'),
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
});

export const rolePermissions = sqliteTable('role_permissions', {
  roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permission: text('permission').notNull(),
  assignedAt: text('assigned_at').notNull(),
  assignedBy: text('assigned_by'),
}, (table) => ({
  pk: primaryKey({ columns: [table.roleId, table.permission] }),
}));

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  permissions: text('permissions').notNull().default('[]'),
  scopesJson: text('scopes_json').notNull().default('[]'),
  expiresAt: text('expires_at'),
  revokedAt: text('revoked_at'),
  allowedIpsJson: text('allowed_ips_json').notNull().default('[]'),
  rateLimitProfile: text('rate_limit_profile').notNull().default('strict'),
  environment: text('environment').notNull().default('prod'),
  purpose: text('purpose').notNull().default(''),
  scopeVersion: integer('scope_version').notNull().default(1),
  isRevoked: integer('is_revoked', { mode: 'boolean' }).notNull().default(false),
  lastUsedAt: text('last_used_at'),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sessionBlacklist = sqliteTable('session_blacklist', {
  tokenHash: text('token_hash').primaryKey(),
  staffUserId: text('staff_user_id').notNull().references(() => staffUsers.id, { onDelete: 'cascade' }),
  revokedAt: text('revoked_at').notNull(),
  expiresAt: text('expires_at').notNull(),
});

export const otpSecrets = sqliteTable('otp_secrets', {
  staffId: text('staff_id').primaryKey().references(() => staffUsers.id, { onDelete: 'cascade' }),
  secretCipher: text('secret_cipher').notNull(),
  backupCodesHash: text('backup_codes_hash').notNull(),
  enabledAt: text('enabled_at').notNull(),
  lastUsedAt: text('last_used_at'),
  updatedAt: text('updated_at').notNull(),
});

export const tamperLockout = sqliteTable('tamper_lockout', {
  ip: text('ip').notNull(),
  windowId: integer('window_id').notNull(),
  count: integer('count').notNull().default(0),
  lastAttemptAt: text('last_attempt_at').notNull(),
  alertedAt: text('alerted_at'),
}, (table) => ({
  pk: primaryKey({ columns: [table.ip, table.windowId] }),
}));

export const passwordResetTokens = sqliteTable('password_reset_tokens', {
  id: text('id').primaryKey(),
  staffId: text('staff_id').notNull().references(() => staffUsers.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
  revokedAt: text('revoked_at'),
  revokedBy: text('revoked_by'),
});

export const passwordResetRateLimits = sqliteTable('password_reset_rate_limits', {
  ipAddress: text('ip_address').notNull(),
  attemptedAt: text('attempted_at').notNull(),
});
