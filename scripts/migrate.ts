/**
 * D1 Migration Runner with Rollback Support [Master_Prompt v7.0 §18.4, Phase 7.4]
 *
 * Scans db/migrations/*.sql, finds the highest applied version in
 * `schema_migrations`, and applies any new ones in order. Each
 * migration is paired with a `db/migrations/rollback/NNNN_*.sql`
 * file (or a `-- ROLLBACK: ...` comment block) that reverses it.
 *
 * Usage:
 *   tsx scripts/migrate.ts           # apply pending
 *   tsx scripts/migrate.ts --status  # show applied/pending
 *   tsx scripts/migrate.ts --rollback <version>
 *   tsx scripts/migrate.ts --rollback-last
 *
 * The runner uses wrangler d1 execute to apply SQL (D1 can't be
 * driven directly from a local script in advanced runtime). In CI
 * the runner shells out:
 *   wrangler d1 execute <db> --remote --file=<migration.sql>
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const MIGRATIONS_DIR = "db/migrations";
const ROLLBACK_DIR = "db/migrations/rollback";
const DB_NAME = process.env.D1_DATABASE ?? "zabir-db";

interface MigrationFile {
  version: string;
  path: string;
  rollbackPath?: string;
}

function listMigrations(): MigrationFile[] {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith(".sql"))
    .sort()
    .map(f => {
      const version = f.split("_")[0];
      const rollbackPath = existsSync(`${ROLLBACK_DIR}/${f}`) ? `${ROLLBACK_DIR}/${f}` : undefined;
      return { version, path: `${MIGRATIONS_DIR}/${f}`, rollbackPath };
    });
}

function sh(cmd: string): string {
  return execSync(cmd, { stdio: "pipe", encoding: "utf8" });
}

function listApplied(): string[] {
  const out = sh(`npx wrangler d1 execute ${DB_NAME} --remote --command "SELECT version FROM schema_migrations ORDER BY version"`);
  const lines = out.split("\n").filter(l => /^\d{4}_/.test(l.trim()));
  return lines.map(l => l.trim().split(/\s+/)[0]);
}

function status(): void {
  const all = listMigrations();
  const applied = listApplied();
  console.log(`Applied (${applied.length}): ${applied.join(", ") || "none"}`);
  const pending = all.filter(m => !applied.includes(m.version));
  console.log(`Pending (${pending.length}): ${pending.map(m => m.version).join(", ") || "none"}`);
  for (const m of all) {
    const flag = applied.includes(m.version) ? "✓" : pending.find(p => p.version === m.version) ? "→" : "·";
    const rollback = m.rollbackPath ? "(rollback ready)" : "(no rollback)";
    console.log(`  ${flag} ${m.version} ${rollback} — ${m.path}`);
  }
}

function applyPending(): void {
  const all = listMigrations();
  const applied = listApplied();
  const pending = all.filter(m => !applied.includes(m.version));
  if (pending.length === 0) {
    console.log("Nothing to apply.");
    return;
  }
  for (const m of pending) {
    console.log(`Applying ${m.version} from ${m.path} ...`);
    try {
      sh(`npx wrangler d1 execute ${DB_NAME} --remote --file=${m.path}`);
      console.log(`  ✓ ${m.version} applied.`);
    } catch (err) {
      console.error(`  ✗ ${m.version} FAILED:`, err);
      process.exit(1);
    }
  }
}

function rollback(version: string): void {
  const m = listMigrations().find(x => x.version === version);
  if (!m) {
    console.error(`Unknown version ${version}`);
    process.exit(1);
  }
  if (!m.rollbackPath) {
    console.error(`No rollback file for ${version}. Expected ${ROLLBACK_DIR}/${m.path.split("/").pop()}`);
    process.exit(1);
  }
  console.log(`Rolling back ${m.version} via ${m.rollbackPath} ...`);
  sh(`npx wrangler d1 execute ${DB_NAME} --remote --file=${m.rollbackPath}`);
  // Also drop the schema_migrations row.
  sh(`npx wrangler d1 execute ${DB_NAME} --remote --command "DELETE FROM schema_migrations WHERE version = '${m.version}'"`);
  console.log(`  ✓ ${m.version} rolled back.`);
}

const args = process.argv.slice(2);
if (args.includes("--status")) {
  status();
} else if (args.includes("--rollback")) {
  const v = args[args.indexOf("--rollback") + 1];
  if (!v) {
    console.error("Usage: --rollback <version>");
    process.exit(1);
  }
  rollback(v);
} else if (args.includes("--rollback-last")) {
  const applied = listApplied();
  if (applied.length === 0) {
    console.log("No migrations to roll back.");
  } else {
    rollback(applied[applied.length - 1]);
  }
} else {
  applyPending();
}
