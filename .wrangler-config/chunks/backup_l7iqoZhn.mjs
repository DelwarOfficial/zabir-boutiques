globalThis.process ??= {};
globalThis.process.env ??= {};
import { n as nowSql } from "./sequence_XySMyPne.mjs";
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
  "fraud_polls"
];
async function backupD1ToR2(db, backups) {
  if (!backups) return { written: 0, size: 0 };
  const ts = nowSql().replace(/[: ]/g, "-");
  let size = 0;
  const stmts = [];
  stmts.push(`-- Zabir Boutiques D1 backup ${ts}`);
  stmts.push(`PRAGMA foreign_keys = OFF;`);
  stmts.push(`BEGIN TRANSACTION;`);
  for (const table of TABLES) {
    try {
      const rows = await db.prepare(`SELECT * FROM ${table}`).all();
      const result = rows.results ?? [];
      stmts.push(`-- Table: ${table} (${result.length} rows)`);
      if (result.length === 0) continue;
      const cols = Object.keys(result[0]);
      stmts.push(`DELETE FROM ${table};`);
      for (const r of result) {
        const vals = cols.map((c) => {
          const v = r[c];
          if (v === null || v === void 0) return "NULL";
          if (typeof v === "number") return String(v);
          if (typeof v === "boolean") return v ? "1" : "0";
          return `'${String(v).replace(/'/g, "''")}'`;
        }).join(",");
        stmts.push(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${vals});`);
      }
    } catch (err) {
      stmts.push(`-- Skipped ${table}: ${err.message}`);
    }
  }
  stmts.push(`COMMIT;`);
  stmts.push(`PRAGMA foreign_keys = ON;`);
  const body = stmts.join("\n");
  size = body.length;
  await backups.put(`backups/d1-${ts}.sql`, body, {
    httpMetadata: { contentType: "application/sql" },
    customMetadata: { rowCount: String(size) }
  });
  const listed = await backups.list({ prefix: "backups/d1-" });
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1e3;
  for (const obj of listed.objects) {
    if (obj.uploaded && obj.uploaded.getTime() < cutoff) {
      await backups.delete(obj.key);
    }
  }
  return { written: 1, size };
}
async function verifyBackup(db, backups) {
  if (!backups) return { ok: false };
  const listed = await backups.list({ prefix: "backups/d1-" });
  const sorted = (listed.objects ?? []).sort((a, b) => (b.uploaded?.getTime() ?? 0) - (a.uploaded?.getTime() ?? 0));
  const latest = sorted[0];
  if (!latest) {
    await db.prepare(
      `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
         VALUES (?1, 'system', 'No D1 backups found in R2', ?2)`
    ).bind(crypto.randomUUID(), nowSql()).run();
    return { ok: false };
  }
  const ageHours = (Date.now() - (latest.uploaded?.getTime() ?? 0)) / 36e5;
  if (ageHours > 26) {
    await db.prepare(
      `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
         VALUES (?1, 'system', ?2, ?3)`
    ).bind(crypto.randomUUID(), `Latest D1 backup is ${ageHours.toFixed(1)}h old`, nowSql()).run();
    return { ok: false, latestKey: latest.key };
  }
  return { ok: true, latestKey: latest.key };
}
export {
  backupD1ToR2,
  verifyBackup
};
