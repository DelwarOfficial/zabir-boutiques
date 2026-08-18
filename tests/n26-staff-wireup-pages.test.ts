import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * N-26: four staff pages shipped as ComingSoon placeholders despite the data
 * to back them already existing. Wired to real queries.
 *
 * The two remaining placeholders (sales/notes, support/escalations) have no
 * backing table and no defined concept, so they stay placeholders rather than
 * being built against invented schema.
 */
const read = (p: string) => readFileSync(resolve(p), 'utf8');

const PACKED = read('src/pages/staff/packing/packed.astro');
const SEARCH = read('src/pages/staff/sales/search.astro');
const SLIPS = read('src/pages/staff/packing/slips.astro');
const BACKUPS = read('src/pages/staff/backups/index.astro');
const LABELS_API = read('src/pages/api/staff/orders/labels.ts');

const WIRED = { packed: PACKED, search: SEARCH, slips: SLIPS, backups: BACKUPS };

describe('N-26: wired-up staff pages', () => {
  it('no longer render the ComingSoon placeholder', () => {
    for (const [name, src] of Object.entries(WIRED)) {
      expect(src, `${name} still renders ComingSoon`).not.toContain('ComingSoon');
    }
  });

  it('each keeps its RBAC gate and auth redirect', () => {
    for (const [name, src] of Object.entries(WIRED)) {
      expect(src, `${name} lost its auth redirect`).toContain("Astro.redirect('/staff/login')");
      expect(src, `${name} lost its permission check`).toMatch(/can\(user\.role,|isSuperAdmin\(user\.role\)/);
    }
  });

  it('order queries reference only columns that exist on orders', () => {
    // Guards the mistake this page set already made once: courier_tracking_id
    // does not exist; the real column is courier_tracking_number.
    const known = new Set([
      'id', 'order_number', 'name', 'phone', 'address', 'total_paisa',
      'payment_method', 'advance_paisa', 'balance_paisa', 'status',
      'payment_status', 'created_at', 'updated_at',
      'courier_provider', 'courier_tracking_number', 'courier_handoff_at',
      // Computed alias from packed.astro's julianday() expression, not a
      // stored column — read back off the row in the template.
      'days_waiting',
    ]);
    for (const [name, src] of Object.entries({ packed: PACKED, search: SEARCH, slips: SLIPS })) {
      for (const ref of src.match(/\bo\.([a-z_]+)/g) ?? []) {
        const col = ref.slice(2);
        expect(known.has(col), `${name} selects unknown orders column: ${col}`).toBe(true);
      }
    }
  });

  it('search parameterises every user-supplied value', () => {
    // The query legitimately interpolates a *generated placeholder list*
    // (?3,?4,…), so a blanket "no ${} in SQL" check false-positives. What
    // actually matters is that no user-supplied value is interpolated: the
    // search term and its LIKE form must arrive only through .bind().
    const sql = SEARCH.slice(SEARCH.indexOf('SELECT o.id'), SEARCH.indexOf('.bind('));
    expect(sql).not.toContain('${q}');
    expect(sql).not.toContain('${like}');
    expect(sql).not.toMatch(/\$\{[^}]*\b(q|like|searchParams)\b[^}]*\}/);
    expect(SEARCH).toContain('.bind(q, like, ...candidates)');
  });

  it('batch label route exists, is permission-gated, and caps the print size', () => {
    expect(existsSync(resolve('src/pages/api/staff/orders/labels.ts'))).toBe(true);
    expect(LABELS_API).toContain("requirePermission(user, 'orders.view')");
    expect(LABELS_API).toMatch(/MAX_LABELS/);
    expect(LABELS_API).toContain('renderLabel');
  });

  it('batch labels reuse the single-label renderer rather than a second template', () => {
    // A divergence here would mean couriers scanning two different formats for
    // the same order depending on which button staff pressed.
    const single = read('src/pages/api/staff/orders/[id]/label.ts');
    expect(single).toContain('renderLabel');
    expect(LABELS_API).toContain("from '../../../../lib/integrations/courier/index'");
  });

  it('backups page reads the R2 bucket directly and never exposes restore', () => {
    expect(BACKUPS).toContain("bucket.list({ prefix: 'backups/d1-' })");
    // Restore overwrites live data — it must not be a button in the UI.
    expect(BACKUPS).not.toMatch(/restoreParity|\/api\/.*restore/);
  });

  it('pages without backing schema stay placeholders instead of inventing tables', () => {
    for (const p of ['src/pages/staff/sales/notes.astro', 'src/pages/staff/support/escalations.astro']) {
      expect(read(p), `${p} should still be a placeholder`).toContain('ComingSoon');
    }
  });
});
