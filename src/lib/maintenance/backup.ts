/**
 * D1 Backup to R2 [v6.8A]
 * Weekly Sunday 04:00 UTC — Export key business tables to R2.
 * Backups stored in R2: backups/d1/weekly/YYYY-MM-DD-zabir-db.json
 * Keep last 8 weekly backups minimum.
 */

const BACKUP_TABLES = [
  'orders', 'order_items', 'payments', 'payment_events',
  'products', 'product_variants', 'inventory_items', 'categories',
  'staff_users', 'coupons', 'site_settings'
];

export async function backupD1ToR2(db: D1Database, backups: R2Bucket): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const backupData: Record<string, unknown[]> = {};

  for (const table of BACKUP_TABLES) {
    const result = await db.prepare(`SELECT * FROM ${table}`).all();
    backupData[table] = result.results ?? [];
  }

  const key = `backups/d1/weekly/${date}-zabir-db.json`;
  await backups.put(key, JSON.stringify(backupData, null, 2));
}
