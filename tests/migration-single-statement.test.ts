import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve('./db/migrations');

/**
 * Counts top-level SQL statements in a migration file. Strips `--` line
 * comments, then counts non-empty fragments split on `;`. This is a
 * heuristic (it does not parse BEGIN/END trigger bodies specially), so it
 * is only applied to the V8 migrations (0040+), which are known not to
 * contain triggers. Pre-V8 migrations (0001-0039) are exempt — the
 * one-statement-per-file rule was adopted starting with this work, not
 * applied retroactively.
 */
function countStatements(sql: string): number {
  const stripped = sql
    .split('\n')
    // `.` does not match \r in JS, so on a CRLF file `--.*$` never reaches
    // end-of-line and strips nothing — leaving any `;` inside a comment to be
    // miscounted as a statement boundary. Trim the \r first.
    .map((line) => line.replace(/\r$/, '').replace(/--.*$/, ''))
    .join('\n');
  return stripped
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;
}

describe('migration-single-statement (V8 discipline, T-27)', () => {
  it('every V8 migration file (0040+) contains exactly one structural statement, plus only its own supporting indexes', () => {
    // Two exemptions, both matching pre-existing repository precedent
    // rather than inventing new leniency:
    //   1. Bulk data-seed files (0037_site_settings_seed.sql already has
    //      12 INSERT statements in one file; multiple idempotent
    //      INSERT OR IGNORE rows don't carry partial-apply risk).
    //   2. A CREATE TABLE followed by CREATE INDEX statements for indexes
    //      on that same new table (0001_initial_v6_8a_schema.sql already
    //      bundles table + index in the same statement group for
    //      stock_reservations). The real risk this rule guards against is
    //      an ALTER TABLE / structural rebuild half-applying — a brand
    //      new empty table getting its own index in the same file is not
    //      that risk.
    //   3. A full table rebuild wrapped in its own PRAGMA/BEGIN..COMMIT
    //      transaction (CREATE ..._new, INSERT..SELECT, DROP, RENAME) —
    //      same pattern and justification as 0018_schema_constraints.sql's
    //      pre-V8 rebuilds. Splitting a rebuild across multiple migration
    //      files would be the actual danger here: each file applies
    //      separately, so a mid-rebuild failure between files would leave
    //      two coexisting tables instead of rolling back cleanly. The
    //      BEGIN/COMMIT wrapper is what keeps this atomic, not a 1-statement
    //      file.
    // What is NOT exempt: two unrelated statements, or an ALTER TABLE
    // sharing a file with anything else.
    const files = readdirSync(MIGRATIONS)
      .filter((f) => /^\d{4}_.+\.sql$/.test(f))
      .filter((f) => Number(f.slice(0, 4)) >= 40)
      .filter((f) => !f.includes('_seed_'))
      .filter((f) => {
        const sql = readFileSync(resolve(MIGRATIONS, f), 'utf8');
        const isRebuild = /^\s*BEGIN TRANSACTION/im.test(sql) && /DROP TABLE/i.test(sql) && /RENAME TO/i.test(sql);
        return !isRebuild;
      })
      //   4. Trigger definitions. countStatements() splits on `;`, and a
      //      trigger's BEGIN...END body contains its own statement
      //      terminators, so the heuristic counts one CREATE TRIGGER as
      //      several. This exemption was always implied — the docblock above
      //      countStatements() states the rule only holds for files "known
      //      not to contain triggers" — but 0058_audit_log_redaction_triggers
      //      is the first V8 migration that does, so it now has to be
      //      explicit. Trigger files are still covered by the ALTER TABLE
      //      assertion below and by their own behavioural tests.
      .filter((f) => !/CREATE\s+TRIGGER/i.test(readFileSync(resolve(MIGRATIONS, f), 'utf8')))
      .sort();

    expect(files.length).toBeGreaterThanOrEqual(7); // 0040, 0042-0047

    for (const file of files) {
      const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
      const structuralCount = countStatements(
        sql
          .split('\n')
          .filter((line) => !/^\s*CREATE (UNIQUE )?INDEX/i.test(line))
          .join('\n'),
      );
      // 0 is allowed for an index-only migration: CREATE INDEX carries none
      // of the partial-apply risk this rule guards against, and splitting an
      // index out of an ALTER TABLE file is exactly what the assertion below
      // forces. Anything above 1 is still a violation.
      expect(structuralCount, `${file} should have at most 1 non-index statement, found ${structuralCount}`).toBeLessThanOrEqual(1);
      if (structuralCount === 0) {
        expect(/CREATE\s+(UNIQUE\s+)?INDEX/i.test(sql), `${file} has no statements at all`).toBe(true);
      }

      if (/^\s*ALTER TABLE/im.test(sql)) {
        // ALTER TABLE (structural rebuild risk) must be truly alone.
        const total = countStatements(sql);
        expect(total, `${file} is an ALTER TABLE and must not share a file with anything else`).toBe(1);
      }
    }
  });

  it('trigger migrations (exempt from the statement count) still never mix in an ALTER TABLE', () => {
    // The CREATE TRIGGER exemption above skips the `;`-splitting statement
    // count, so this asserts the property that exemption would otherwise
    // drop: a trigger file must not also carry a schema-altering statement,
    // which is the partial-apply risk the whole rule exists to prevent.
    const triggerFiles = readdirSync(MIGRATIONS)
      .filter((f) => /^\d{4}_.+\.sql$/.test(f))
      .filter((f) => Number(f.slice(0, 4)) >= 40)
      .filter((f) => /CREATE\s+TRIGGER/i.test(readFileSync(resolve(MIGRATIONS, f), 'utf8')));

    for (const file of triggerFiles) {
      const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
      expect(/^\s*ALTER TABLE/im.test(sql), `${file} mixes ALTER TABLE with trigger definitions`).toBe(false);
      expect(/^\s*CREATE TABLE/im.test(sql), `${file} mixes CREATE TABLE with trigger definitions`).toBe(false);
    }
  });

  it('every V8 migration (0040+) has a matching rollback file', () => {
    const forward = readdirSync(MIGRATIONS).filter((f) => /^\d{4}_.+\.sql$/.test(f) && Number(f.slice(0, 4)) >= 40);
    const rollbackDir = resolve(MIGRATIONS, 'rollback');
    const rollbacks = new Set(readdirSync(rollbackDir));

    for (const file of forward) {
      const num = file.slice(0, 4);
      const hasRollback = [...rollbacks].some((r) => r.startsWith(`${num}_rollback_`) || r.startsWith(`${num}_`));
      expect(hasRollback, `${file} is missing a rollback file`).toBe(true);
    }
  });

  it('migration numbers 0040-0047 are contiguous with no gaps or reuse', () => {
    const files = readdirSync(MIGRATIONS)
      .filter((f) => /^\d{4}_.+\.sql$/.test(f))
      .map((f) => Number(f.slice(0, 4)))
      .filter((n) => n >= 40)
      .sort((a, b) => a - b);

    for (let i = 1; i < files.length; i++) {
      expect(files[i]).toBe(files[i - 1] + 1);
    }
  });
});
