import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS_DIR = resolve('./db/migrations');

function readMigration(name: string): string {
  return readFileSync(resolve(MIGRATIONS_DIR, name), 'utf-8');
}

describe('D1 Schema CHECK constraints (Master Plan G3/G5)', () => {
  const initial = readMigration('0001_initial_v6_8a_schema.sql');
  const variants = readMigration('0017_variants_stock_generated.sql');
  const constraints = readMigration('0018_schema_constraints.sql');

  it('all money columns in 0001 use INTEGER paisa (no floats)', () => {
    const moneyCols = initial.match(/\w+_paisa\s+INTEGER/g) ?? [];
    expect(moneyCols.length).toBeGreaterThan(10);
    expect(initial).not.toMatch(/_paisa\s+REAL/i);
    expect(initial).not.toMatch(/_paisa\s+FLOAT/i);
    expect(initial).not.toMatch(/_paisa\s+NUMERIC/i);
  });

  it('0001 orders money columns have non-negative CHECK', () => {
    expect(initial).toMatch(/subtotal_paisa INTEGER NOT NULL CHECK \(subtotal_paisa >= 0\)/);
    expect(initial).toMatch(/total_paisa INTEGER NOT NULL CHECK \(total_paisa >= 0\)/);
    expect(initial).toMatch(/advance_paisa INTEGER NOT NULL DEFAULT 0 CHECK \(advance_paisa >= 0\)/);
  });

  it('0017 inventory_items has available GENERATED column', () => {
    expect(variants).toMatch(
      /available INTEGER GENERATED ALWAYS AS \(quantity - reserved_quantity - sold_quantity\) STORED/,
    );
    expect(variants).toContain('CREATE VIEW IF NOT EXISTS variants');
  });

  it('0018 closes invoice_payments amount_paisa CHECK gap', () => {
    expect(constraints).toMatch(/amount_paisa INTEGER NOT NULL CHECK \(amount_paisa >= 0\)/);
  });

  it('0018 closes coupons money CHECK gaps', () => {
    expect(constraints).toMatch(
      /discount_amount_paisa INTEGER CHECK \(discount_amount_paisa IS NULL OR discount_amount_paisa >= 0\)/,
    );
    expect(constraints).toMatch(
      /max_discount_paisa INTEGER CHECK \(max_discount_paisa IS NULL OR max_discount_paisa >= 0\)/,
    );
    expect(constraints).toMatch(/min_order_paisa INTEGER NOT NULL DEFAULT 0 CHECK \(min_order_paisa >= 0\)/);
  });

  it('0018 adds sold_quantity to inventory_baseline', () => {
    expect(constraints).toMatch(
      /ALTER TABLE inventory_baseline ADD COLUMN sold_quantity INTEGER NOT NULL DEFAULT 0 CHECK \(sold_quantity >= 0\)/,
    );
  });

  it('0018 has paired rollback migration', () => {
    const rollback = readFileSync(
      resolve('./db/migrations/rollback/0018_rollback_schema_constraints.sql'),
      'utf-8',
    );
    expect(rollback).toContain("DELETE FROM schema_migrations WHERE version = '0018_schema_constraints'");
  });
});