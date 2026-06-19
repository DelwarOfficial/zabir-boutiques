import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { D1Mock } from './stubs/d1-mock';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function apply(sqlPath: string): void {
  const db = new D1Mock();
  db.exec(read(sqlPath));
}

function db(sqlPath: string): D1Mock {
  const db = new D1Mock();
  db.exec(read(sqlPath));
  return db;
}

function dbWithBase(sqlPath: string, baseSql: string): D1Mock {
  const db = new D1Mock();
  db.exec(baseSql);
  db.exec(read(sqlPath));
  return db;
}

describe('migration fixtures — DDL execution', () => {
  // 0021: otp_secrets table
  it('0021 creates otp_secrets table with correct columns', () => {
    const d = db('db/migrations/0021_create_otp_secrets.sql');
    expect(d.hasTable('otp_secrets')).toBe(true);
    expect(d.hasColumn('otp_secrets', 'staff_id')).toBe(true);
    expect(d.hasColumn('otp_secrets', 'secret_cipher')).toBe(true);
    expect(d.hasColumn('otp_secrets', 'backup_codes_hash')).toBe(true);
    expect(d.hasColumn('otp_secrets', 'enabled_at')).toBe(true);
    expect(d.hasColumn('otp_secrets', 'last_used_at')).toBe(true);
    expect(d.hasColumn('otp_secrets', 'updated_at')).toBe(true);
    expect(d.hasIndex('idx_otp_secrets_enabled')).toBe(true);
  });

  it('0021 rollback drops otp_secrets table and index', () => {
    const d = new D1Mock();
    d.exec(read('db/migrations/0021_create_otp_secrets.sql'));
    expect(d.hasTable('otp_secrets')).toBe(true);
    d.exec(read('db/migrations/rollback/0021_rollback_create_otp_secrets.sql'));
    expect(d.hasTable('otp_secrets')).toBe(false);
    expect(d.hasIndex('idx_otp_secrets_enabled')).toBe(false);
  });

  // 0022: api_audit_logs table
  it('0022 creates api_audit_logs table with indexes', () => {
    const d = db('db/migrations/0022_create_api_audit_logs.sql');
    expect(d.hasTable('api_audit_logs')).toBe(true);
    expect(d.hasColumn('api_audit_logs', 'audit_id')).toBe(true);
    expect(d.hasColumn('api_audit_logs', 'provider')).toBe(true);
    expect(d.hasColumn('api_audit_logs', 'status')).toBe(true);
    expect(d.hasColumn('api_audit_logs', 'duration_ms')).toBe(true);
    expect(d.hasIndex('idx_api_audit_provider_created')).toBe(true);
    expect(d.hasIndex('idx_api_audit_circuit_state')).toBe(true);
    expect(d.hasIndex('idx_api_audit_order')).toBe(true);
  });

  it('0022 rollback drops api_audit_logs table', () => {
    const d = new D1Mock();
    d.exec(read('db/migrations/0022_create_api_audit_logs.sql'));
    expect(d.hasTable('api_audit_logs')).toBe(true);
    d.exec(read('db/migrations/rollback/0022_rollback_create_api_audit_logs.sql'));
    expect(d.hasTable('api_audit_logs')).toBe(false);
    expect(d.hasIndex('idx_api_audit_provider_created')).toBe(false);
    expect(d.hasIndex('idx_api_audit_circuit_state')).toBe(false);
    expect(d.hasIndex('idx_api_audit_order')).toBe(false);
  });

  // 0023: ai_budget_limits table
  it('0023 creates ai_budget_limits table', () => {
    const d = db('db/migrations/0023_create_ai_budget_limits.sql');
    expect(d.hasTable('ai_budget_limits')).toBe(true);
    expect(d.hasColumn('ai_budget_limits', 'provider')).toBe(true);
    expect(d.hasColumn('ai_budget_limits', 'daily_limit_usd_cents')).toBe(true);
    expect(d.hasColumn('ai_budget_limits', 'monthly_limit_usd_cents')).toBe(true);
    expect(d.hasColumn('ai_budget_limits', 'daily_call_limit')).toBe(true);
    expect(d.hasColumn('ai_budget_limits', 'monthly_call_limit')).toBe(true);
    expect(d.hasColumn('ai_budget_limits', 'soft_alert_percent')).toBe(true);
    expect(d.hasColumn('ai_budget_limits', 'hard_block_percent')).toBe(true);
    expect(d.hasColumn('ai_budget_limits', 'owner_override')).toBe(true);
    expect(d.hasColumn('ai_budget_limits', 'updated_at')).toBe(true);
    expect(d.hasColumn('ai_budget_limits', 'updated_by_staff_id')).toBe(true);
  });

  it('0023 rollback drops ai_budget_limits table', () => {
    const d = new D1Mock();
    d.exec(read('db/migrations/0023_create_ai_budget_limits.sql'));
    expect(d.hasTable('ai_budget_limits')).toBe(true);
    d.exec(read('db/migrations/rollback/0023_rollback_create_ai_budget_limits.sql'));
    expect(d.hasTable('ai_budget_limits')).toBe(false);
  });

  // 0024: stock_reservations ALTER + unique index
  it('0024 adds release_requested_at column and unique index on stock_reservations', () => {
    const base = 'CREATE TABLE stock_reservations (id TEXT PRIMARY KEY, order_id TEXT, variant_id TEXT, status TEXT DEFAULT \'active\');';
    const d = dbWithBase('db/migrations/0024_stock_reservations_unique_constraint.sql', base);
    expect(d.hasColumn('stock_reservations', 'release_requested_at')).toBe(true);
    expect(d.hasIndex('idx_stock_reservations_order_active')).toBe(true);
    const idx = d.getSchema().indexes.get('idx_stock_reservations_order_active')!;
    expect(idx.unique).toBe(true);
    expect(idx.columns).toContain('order_id');
    expect(idx.columns).toContain('variant_id');
  });

  it('0024 rollback drops the unique index (release_requested_at column left in place)', () => {
    const base = 'CREATE TABLE stock_reservations (id TEXT PRIMARY KEY, order_id TEXT, variant_id TEXT, status TEXT DEFAULT \'active\');';
    const d = dbWithBase('db/migrations/0024_stock_reservations_unique_constraint.sql', base);
    expect(d.hasIndex('idx_stock_reservations_order_active')).toBe(true);
    d.exec(read('db/migrations/rollback/0024_rollback_stock_reservations_unique_constraint.sql'));
    expect(d.hasIndex('idx_stock_reservations_order_active')).toBe(false);
    expect(d.hasColumn('stock_reservations', 'release_requested_at')).toBe(true);
  });

  // 0025: cart_activity cleanup
  it('0025 adds abandoned_email_sent_at, drops legacy columns, creates indexes', () => {
    const base = 'CREATE TABLE cart_activity (id TEXT PRIMARY KEY, last_cart_update_at TEXT, converted_order_id TEXT, customer_email TEXT, abandoned_1h_sent_at TEXT, abandoned_24h_sent_at TEXT);';
    const d = dbWithBase('db/migrations/0025_cart_activity_v7_cleanup.sql', base);
    expect(d.hasColumn('cart_activity', 'abandoned_email_sent_at')).toBe(true);
    expect(d.hasColumn('cart_activity', 'abandoned_1h_sent_at')).toBe(false);
    expect(d.hasColumn('cart_activity', 'abandoned_24h_sent_at')).toBe(false);
    expect(d.hasIndex('idx_cart_activity_abandoned')).toBe(true);
    expect(d.hasIndex('idx_cart_activity_email')).toBe(true);
  });

  it('0025 rollback restores legacy columns and rebuilds old index', () => {
    const base = 'CREATE TABLE cart_activity (id TEXT PRIMARY KEY, last_cart_update_at TEXT, converted_order_id TEXT, customer_email TEXT);';
    const migrate = new D1Mock();
    migrate.exec(base);
    migrate.exec(read('db/migrations/0025_cart_activity_v7_cleanup.sql'));
    migrate.exec(read('db/migrations/rollback/0025_rollback_cart_activity_v7_cleanup.sql'));
    expect(migrate.hasColumn('cart_activity', 'abandoned_1h_sent_at')).toBe(true);
    expect(migrate.hasColumn('cart_activity', 'abandoned_24h_sent_at')).toBe(true);
    expect(migrate.hasColumn('cart_activity', 'abandoned_email_sent_at')).toBe(true);
    expect(migrate.hasIndex('idx_cart_activity_abandoned')).toBe(true);
  });

  // 0026: VAT columns
  it('0026 adds vat_paisa to orders and order_items', () => {
    const base = 'CREATE TABLE orders (id TEXT PRIMARY KEY, total_paisa INTEGER); CREATE TABLE order_items (id TEXT PRIMARY KEY, order_id TEXT, unit_price_paisa INTEGER);';
    const d = dbWithBase('db/migrations/0026_add_checkout_vat_paisa.sql', base);
    expect(d.hasColumn('orders', 'vat_paisa')).toBe(true);
    expect(d.hasColumn('order_items', 'vat_paisa')).toBe(true);
  });

  it('0026 rollback leaves vat_paisa in place (ROLLBACK_EXCEPTION)', () => {
    const base = 'CREATE TABLE orders (id TEXT PRIMARY KEY, total_paisa INTEGER); CREATE TABLE order_items (id TEXT PRIMARY KEY, order_id TEXT, unit_price_paisa INTEGER);';
    const d = dbWithBase('db/migrations/0026_add_checkout_vat_paisa.sql', base);
    d.exec(read('db/migrations/rollback/0026_rollback_add_checkout_vat_paisa.sql'));
    expect(d.hasColumn('orders', 'vat_paisa')).toBe(true);
    expect(d.hasColumn('order_items', 'vat_paisa')).toBe(true);
  });

  // 0027: stock_reservations V7 rebuild
  it('0027 rebuilds stock_reservations table with release_requested status support', () => {
    const base = 'CREATE TABLE stock_reservations (id TEXT PRIMARY KEY, order_id TEXT, variant_id TEXT, quantity INTEGER, status TEXT DEFAULT \'active\', expires_at TEXT, created_at TEXT, updated_at TEXT);';
    const d = dbWithBase('db/migrations/0027_stock_reservations_status_rebuild.sql', base);
    expect(d.hasTable('stock_reservations')).toBe(true);
    expect(d.hasColumn('stock_reservations', 'release_requested_at')).toBe(true);
    expect(d.hasIndex('idx_reservations_status_expires')).toBe(true);
    expect(d.hasIndex('idx_reservations_order')).toBe(true);
    expect(d.hasIndex('idx_stock_reservations_order_active')).toBe(true);
  });

  it('0027 rollback does not throw (ROLLBACK_EXCEPTION)', () => {
    const base = 'CREATE TABLE stock_reservations (id TEXT PRIMARY KEY, order_id TEXT, variant_id TEXT, quantity INTEGER, status TEXT DEFAULT \'active\', expires_at TEXT, created_at TEXT, updated_at TEXT);';
    const d = dbWithBase('db/migrations/0027_stock_reservations_status_rebuild.sql', base);
    expect(() => { d.exec(read('db/migrations/rollback/0027_rollback_stock_reservations_status_rebuild.sql')); }).not.toThrow();
  });

  // 0028: index shape fix
  it('0028 drops and recreates the active reservation index with correct shape', () => {
    const base = 'CREATE TABLE stock_reservations (id TEXT PRIMARY KEY, order_id TEXT, variant_id TEXT, status TEXT DEFAULT \'active\'); CREATE INDEX idx_stock_reservations_order_active ON stock_reservations(order_id) WHERE status = \'active\';';
    const d = dbWithBase('db/migrations/0028_fix_stock_reservations_active_index_shape.sql', base);
    expect(d.hasIndex('idx_stock_reservations_order_active')).toBe(true);
    const idx = d.getSchema().indexes.get('idx_stock_reservations_order_active')!;
    expect(idx.columns).toContain('order_id');
    expect(idx.columns).toContain('variant_id');
  });

  it('0028 rollback restores old index shape (order_id only)', () => {
    const base = 'CREATE TABLE stock_reservations (id TEXT PRIMARY KEY, order_id TEXT, variant_id TEXT, status TEXT DEFAULT \'active\');';
    const d = dbWithBase('db/migrations/0028_fix_stock_reservations_active_index_shape.sql', base);
    d.exec(read('db/migrations/rollback/0028_rollback_fix_stock_reservations_active_index_shape.sql'));
    expect(d.hasIndex('idx_stock_reservations_order_active')).toBe(true);
    const idx = d.getSchema().indexes.get('idx_stock_reservations_order_active')!;
    expect(idx.columns).toEqual(['order_id']);
  });
});
