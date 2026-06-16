/**
 * D1 Backup → R2 [Master_Prompt v7.0 §19.2, G14]
 *
 * Cron every 6 hours exports all 21 tables to a SQL dump in R2 under
 * backups/d1-{timestamp}.sql. The cron queues the work via d1-backup
 * queue; this module runs the actual export and writes the file.
 *
 * Restoration: `wrangler d1 execute --remote --file=backups/d1-{ts}.sql`
 * is the manual recovery path; the runbook is in docs/disaster-recovery.md
 * (TODO: write that doc in Phase 7).
 */
import { nowSql } from "../dates";

const TABLES = [
  "schema_migrations",
  "staff_users",
  "staff_sessions",
  "categories",
  "products",
  "product_variants",
  "product_images",
  "inventory_items",
  "coupons",
  "fraud_checks",
  "orders",
  "order_items",
  "stock_reservations",
  "order_status_history",
  "payments",
  "payment_events",
  "low_stock_alerts",
  "site_settings",
  "audit_log",
  "checkout_idempotency",
  "checkout_idempotency_coupon_claims",
  "fraud_polls",
];

export async function backupD1ToR2(db: D1Database, backups: R2Bucket | undefined): Promise<{ written: number; size: number }> {
  if (!backups) return { written: 0, size: 0 };
  const ts = nowSql().replace(/[: ]/g, "-");
  let size = 0;

  const stmts: string[] = [];
  stmts.push(`-- Zabir Boutiques D1 backup ${ts}`);
  stmts.push(`PRAGMA foreign_keys = OFF;`);
  stmts.push(`BEGIN TRANSACTION;`);

  for (const table of TABLES) {
    try {
      const rows = await db.prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>();
      const result = rows.results ?? [];
      stmts.push(`-- Table: ${table} (${result.length} rows)`);
      if (result.length === 0) continue;
      const cols = Object.keys(result[0]);
      stmts.push(`DELETE FROM ${table};`);
      for (const r of result) {
        const vals = cols.map(c => {
          const v = r[c];
          if (v === null || v === undefined) return "NULL";
          if (typeof v === "number") return String(v);
          if (typeof v === "boolean") return v ? "1" : "0";
          return `'${String(v).replace(/'/g, "''")}'`;
        }).join(",");
        stmts.push(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${vals});`);
      }
    } catch (err) {
      stmts.push(`-- Skipped ${table}: ${(err as Error).message}`);
    }
  }
  stmts.push(`COMMIT;`);
  stmts.push(`PRAGMA foreign_keys = ON;`);

  const body = stmts.join("\n");
  size = body.length;
  await backups.put(`backups/d1-${ts}.sql`, body, {
    httpMetadata: { contentType: "application/sql" },
    customMetadata: { rowCount: String(size) },
  });
  // Retain last 30 days of dailies, prune older.
  const listed = await backups.list({ prefix: "backups/d1-" });
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const obj of listed.objects) {
    if (obj.uploaded && obj.uploaded.getTime() < cutoff) {
      await backups.delete(obj.key);
    }
  }
  return { written: 1, size };
}

/**
 * Weekly verification: list recent backups and ensure at least one
 * exists in the last 26 hours. If not, write an alert.
 */
export async function verifyBackup(db: D1Database, backups: R2Bucket | undefined): Promise<{ ok: boolean; latestKey?: string }> {
  if (!backups) return { ok: false };
  const listed = await backups.list({ prefix: "backups/d1-" });
  const sorted = (listed.objects ?? []).sort((a, b) => (b.uploaded?.getTime() ?? 0) - (a.uploaded?.getTime() ?? 0));
  const latest = sorted[0];
  if (!latest) {
    await db
      .prepare(
        `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
         VALUES (?1, 'system', 'No D1 backups found in R2', ?2)`,
      )
      .bind(crypto.randomUUID(), nowSql())
      .run();
    return { ok: false };
  }
  const ageHours = (Date.now() - (latest.uploaded?.getTime() ?? 0)) / 3_600_000;
  if (ageHours > 26) {
    await db
      .prepare(
        `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
         VALUES (?1, 'system', ?2, ?3)`,
      )
      .bind(crypto.randomUUID(), `Latest D1 backup is ${ageHours.toFixed(1)}h old`, nowSql())
      .run();
    return { ok: false, latestKey: latest.key };
  }
  return { ok: true, latestKey: latest.key };
}
