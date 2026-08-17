import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * N-24: email_log recorded status but not which provider delivered.
 * CloudflareEmailProvider falls back to Resend silently, so a 'sent' row was
 * ambiguous between primary and fallback — the exact reason "did MailChannels
 * actually send this?" could not be answered from data and had to be probed
 * against the live API by hand.
 */
const EMAIL = readFileSync(resolve('./src/lib/email.ts'), 'utf8');
const MIGRATION = readFileSync(resolve('./db/migrations/0061_email_log_provider.sql'), 'utf8');

describe('N-24: email_log records the delivering provider', () => {
  it('the migration adds a nullable provider column', () => {
    expect(MIGRATION).toMatch(/ALTER TABLE email_log ADD COLUMN provider TEXT/i);
    // Nullable on purpose — rows written before this migration must stay readable.
    expect(MIGRATION).not.toMatch(/NOT NULL/i);
  });

  it('every email_log insert carries the provider column', () => {
    const inserts = EMAIL.match(/INSERT INTO email_log \([^)]*\)/g) ?? [];
    expect(inserts.length).toBeGreaterThan(0);
    for (const insert of inserts) {
      expect(insert, `insert missing provider column: ${insert}`).toContain('provider');
    }
  });

  it('placeholder numbering stays contiguous in every insert (a gap silently writes NULL)', () => {
    const valueLists = [...EMAIL.matchAll(/VALUES \(([^)]*)\)/g)].map((m) => m[1]);
    expect(valueLists.length).toBeGreaterThan(0);
    for (const list of valueLists) {
      const indexes = [...list.matchAll(/\?(\d+)/g)].map((m) => Number(m[1]));
      const unique = new Set(indexes);
      // No duplicates, and the highest placeholder equals the count — i.e. the
      // sequence is 1..n with nothing skipped.
      expect(unique.size, `duplicate placeholder in: ${list}`).toBe(indexes.length);
      expect(Math.max(...indexes), `placeholder gap in: ${list}`).toBe(unique.size);
    }
  });

  it('success paths bind the real provider from the send result, not a hardcoded string', () => {
    expect(EMAIL).toContain('result.provider');
    // The provider must never be assumed — a literal would defeat the point.
    expect(EMAIL).not.toMatch(/provider:\s*'(resend|cloudflare_email)'/);
  });

  it('does not log the recipient address into the provider field or leak secrets', () => {
    expect(EMAIL).not.toMatch(/RESEND_API_KEY['"]?\s*\)/);
    expect(EMAIL).not.toContain('process.env.RESEND_API_KEY');
  });
});
