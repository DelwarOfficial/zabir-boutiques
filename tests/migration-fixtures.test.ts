import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('migration fixtures', () => {
  it('0021 forward and rollback define otp secrets schema lifecycle', () => {
    expect(read('db/migrations/0021_create_otp_secrets.sql')).toContain('CREATE TABLE IF NOT EXISTS otp_secrets');
    expect(read('db/migrations/rollback/0021_rollback_create_otp_secrets.sql')).toContain('DROP TABLE IF EXISTS otp_secrets');
  });

  it('0022 forward and rollback define api audit log schema lifecycle', () => {
    expect(read('db/migrations/0022_create_api_audit_logs.sql')).toContain('CREATE TABLE IF NOT EXISTS api_audit_logs');
    expect(read('db/migrations/rollback/0022_rollback_create_api_audit_logs.sql')).toContain('DROP TABLE IF EXISTS api_audit_logs');
  });

  it('0023 forward and rollback define ai budget limits schema lifecycle', () => {
    expect(read('db/migrations/0023_create_ai_budget_limits.sql')).toContain('CREATE TABLE IF NOT EXISTS ai_budget_limits');
    expect(read('db/migrations/rollback/0023_rollback_create_ai_budget_limits.sql')).toContain('DROP TABLE IF EXISTS ai_budget_limits');
  });

  it('0024 forward and rollback manage active reservation uniqueness', () => {
    const forward = read('db/migrations/0024_stock_reservations_unique_constraint.sql');
    const rollback = read('db/migrations/rollback/0024_rollback_stock_reservations_unique_constraint.sql');
    expect(forward).toContain('ALTER TABLE stock_reservations ADD COLUMN release_requested_at TEXT');
    expect(forward).toContain('stock_reservations(order_id, variant_id)');
    expect(rollback).toContain('DROP INDEX IF EXISTS idx_stock_reservations_order_active');
  });

  it('0025 forward and rollback manage abandoned cart cleanup columns', () => {
    const forward = read('db/migrations/0025_cart_activity_v7_cleanup.sql');
    const rollback = read('db/migrations/rollback/0025_rollback_cart_activity_v7_cleanup.sql');
    expect(forward).toContain('abandoned_email_sent_at');
    expect(forward).toContain('DROP COLUMN abandoned_1h_sent_at');
    expect(rollback).toContain('ADD COLUMN abandoned_1h_sent_at');
  });

  it('0026 forward and rollback manage vat paisa columns', () => {
    const forward = read('db/migrations/0026_add_checkout_vat_paisa.sql');
    const rollback = read('db/migrations/rollback/0026_rollback_add_checkout_vat_paisa.sql');
    expect(forward).toContain('vat_paisa');
    expect(rollback).toContain('ROLLBACK_EXCEPTION');
  });

  it('0027 rebuild includes release_requested status and active index', () => {
    const forward = read('db/migrations/0027_stock_reservations_status_rebuild.sql');
    expect(forward).toContain("'release_requested'");
    expect(forward).toContain('stock_reservations(order_id, variant_id)');
  });

  it('0028 forward and rollback repair active index shape', () => {
    const forward = read('db/migrations/0028_fix_stock_reservations_active_index_shape.sql');
    const rollback = read('db/migrations/rollback/0028_rollback_fix_stock_reservations_active_index_shape.sql');
    expect(forward).toContain('stock_reservations(order_id, variant_id)');
    expect(rollback).toContain('stock_reservations(order_id)');
  });
});
