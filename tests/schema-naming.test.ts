import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SCHEMA_PATH = resolve('./db/migrations/0001_initial_v6_8a_schema.sql');

describe('D1 Schema Naming Conventions', () => {
  const schema = readFileSync(SCHEMA_PATH, 'utf-8');

  it('no "revoked" column (must be "is_revoked")', () => {
    const lines = schema.split('\n').filter(l => /revoked/.test(l) && !/is_revoked/.test(l));
    expect(lines).toHaveLength(0);
  });

  it('has is_revoked column in staff_sessions', () => {
    expect(schema).toContain('is_revoked');
  });

  it('no "is_read" column (must be "is_acknowledged")', () => {
    const lines = schema.split('\n').filter(l => /is_read/.test(l));
    expect(lines).toHaveLength(0);
  });

  it('has is_acknowledged column in low_stock_alerts', () => {
    expect(schema).toContain('is_acknowledged');
  });

  it('has is_available in inventory_items', () => {
    expect(schema).toContain('is_available');
  });

  it('uses product_images not product_media', () => {
    expect(schema).not.toContain('product_media');
    expect(schema).toContain('product_images');
  });

  it('orders table has phone, payment_status, fraud_decision, status columns', () => {
    expect(schema).toMatch(/phone\s+TEXT/);
    expect(schema).toMatch(/payment_status\s+TEXT/);
    expect(schema).toMatch(/fraud_decision\s+TEXT/);
    expect(schema).toContain('status TEXT NOT NULL DEFAULT');
  });

  it('payments table has status column', () => {
    expect(schema).toContain('payments');
    expect(schema).toContain('status TEXT NOT NULL');
  });

  it('all IDs are TEXT PRIMARY KEY (no SERIAL)', () => {
    expect(schema).not.toContain('SERIAL');
    expect(schema).not.toContain('AUTOINCREMENT');
    expect(schema).not.toContain('INTEGER PRIMARY KEY');
  });

  it('no PostgreSQL syntax', () => {
    const pgKeywords = ['SERIAL', 'TIMESTAMPTZ', 'SELECT FOR UPDATE', 'pgcrypto', 'BIGSERIAL', '::TEXT', '::INTEGER'];
    for (const kw of pgKeywords) {
      expect(schema).not.toContain(kw);
    }
  });

  it('no runtime datetime(\'now\') usage in schema', () => {
    const linesWithoutComments = schema.split('\n').filter(l => !l.trim().startsWith('--'));
    const linesWithNow = linesWithoutComments.filter(l => l.includes("datetime('now')") || l.includes('datetime("now")'));
    expect(linesWithNow).toHaveLength(0);
  });
});
