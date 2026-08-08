/**
 * DO/D1 inventory parity (T-28, dr-do-d1-parity).
 *
 * VariantInventoryDO is the live concurrency gate for stock; D1
 * `inventory_items` is the durable projection. They are kept in sync by
 * `doSyncFromD1()` after every commit, but nothing ever verified they
 * actually agree — a disaster-recovery drill that only checks D1 row
 * counts (backup.ts verifyBackup) proves nothing about DO state, and a
 * real D1 restore rolls D1 back in time while every DO keeps whatever it
 * had before the incident.
 *
 * Two functions:
 *   - checkDoD1Parity(): read-only. Flags disagreement, does not fix it
 *     (same "flag, don't silently fix" discipline as reconciliation.ts
 *     and the courier remittance shortfall check).
 *   - restoreParity(): the actual recovery action, after a genuine D1
 *     restore — forces every variant's DO state to match the (now
 *     authoritative, just-restored) D1 row via the existing sync path.
 */
import { nowSql } from "../dates";
import { doGetAvailability, doSyncFromD1 } from "../do-client";

export interface ParityMismatch {
  variantId: string;
  do: { stock: number; reserved: number; sold: number };
  d1: { stock: number; reserved: number; sold: number };
}

export interface ParityCheckResult {
  checked: number;
  mismatches: ParityMismatch[];
}

type ParityEnv = {
  DB: D1Database;
  VARIANT_INVENTORY_DO?: DurableObjectNamespace;
};

/**
 * Compare DO live state against D1 inventory_items for every active
 * (non-deleted) variant. Read-only — writes a low_stock_alerts row per
 * mismatch for staff review, exactly like every other reconciliation
 * check in this codebase, and never auto-corrects.
 *
 * If VARIANT_INVENTORY_DO is not bound, doGetAvailability() falls back to
 * reading inventory_items itself, which would trivially "match" D1 on
 * every call. That is not a real parity check, so this function refuses
 * to run and returns { checked: 0, mismatches: [] } instead of reporting
 * a false-positive clean bill of health.
 */
export async function checkDoD1Parity(env: ParityEnv, maxVariants = 500): Promise<ParityCheckResult> {
  if (!env.VARIANT_INVENTORY_DO) {
    return { checked: 0, mismatches: [] };
  }

  const variants = await env.DB
    .prepare(`SELECT id FROM product_variants WHERE is_deleted = 0 LIMIT ?1`)
    .bind(maxVariants)
    .all<{ id: string }>();

  const mismatches: ParityMismatch[] = [];
  let checked = 0;

  for (const row of variants.results ?? []) {
    const variantId = row.id;
    const d1Row = await env.DB
      .prepare(`SELECT quantity, reserved_quantity, COALESCE(sold_quantity, 0) AS sold_quantity FROM inventory_items WHERE variant_id = ?1`)
      .bind(variantId)
      .first<{ quantity: number; reserved_quantity: number; sold_quantity: number }>();
    if (!d1Row) continue; // no inventory row for this variant — nothing to compare
    checked++;

    const doState = await doGetAvailability(env, variantId);

    if (doState.stock !== d1Row.quantity || doState.reserved !== d1Row.reserved_quantity || doState.sold !== d1Row.sold_quantity) {
      mismatches.push({
        variantId,
        do: { stock: doState.stock, reserved: doState.reserved, sold: doState.sold },
        d1: { stock: d1Row.quantity, reserved: d1Row.reserved_quantity, sold: d1Row.sold_quantity },
      });
    }
  }

  if (mismatches.length > 0) {
    const now = nowSql();
    for (const m of mismatches) {
      await env.DB
        .prepare(
          `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
           VALUES (?1, ?2, ?3, ?4)`,
        )
        .bind(
          crypto.randomUUID(),
          m.variantId,
          `DO/D1 inventory parity mismatch: DO(stock=${m.do.stock},reserved=${m.do.reserved},sold=${m.do.sold}) vs D1(stock=${m.d1.stock},reserved=${m.d1.reserved},sold=${m.d1.sold}). Manual review required — call restoreParity() only after confirming which side is authoritative.`,
          now,
        )
        .run();
    }
  }

  return { checked, mismatches };
}

/**
 * The actual DR recovery action: after a genuine D1 restore, D1 is the
 * newly-authoritative source and every DO must be forced back in line
 * with it. Reuses the existing sync path (doSyncFromD1 -> DO "/sync"
 * action) rather than inventing a new DO method — that primitive already
 * exists and is exercised on every normal commit.
 *
 * This is destructive to DO state and must only be called as part of a
 * deliberate restore procedure, never as part of the read-only parity
 * check above.
 */
export async function restoreParity(env: ParityEnv, maxVariants = 500): Promise<{ restored: number }> {
  if (!env.VARIANT_INVENTORY_DO) {
    return { restored: 0 };
  }

  const variants = await env.DB
    .prepare(`SELECT id FROM product_variants WHERE is_deleted = 0 LIMIT ?1`)
    .bind(maxVariants)
    .all<{ id: string }>();

  let restored = 0;
  for (const row of variants.results ?? []) {
    const d1Row = await env.DB
      .prepare(`SELECT quantity, reserved_quantity, COALESCE(sold_quantity, 0) AS sold_quantity FROM inventory_items WHERE variant_id = ?1`)
      .bind(row.id)
      .first<{ quantity: number; reserved_quantity: number; sold_quantity: number }>();
    if (!d1Row) continue;
    await doSyncFromD1(env, row.id, d1Row.quantity, d1Row.reserved_quantity, d1Row.sold_quantity);
    restored++;
  }
  return { restored };
}
