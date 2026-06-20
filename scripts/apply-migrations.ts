import { readdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mode = process.argv.includes('--remote') ? '--remote' : '--local';
const dbName = process.env.D1_DATABASE ?? 'zabir-db';
const dir = 'db/migrations';
const continueOnError = process.argv.includes('--continue-on-error');
const fromArg = process.argv.find((arg) => arg.startsWith('--from='));
const fromVersion = fromArg?.slice('--from='.length);

const files = readdirSync(dir)
  .filter((file) => /^\d{4}_.+\.sql$/.test(file))
  .filter((file) => !fromVersion || file >= fromVersion)
  .sort();

let failures = 0;
const tmpDir = mkdtempSync(join(tmpdir(), 'd1-migrate-'));

function prepareSqlForMode(sql: string): string {
  if (mode !== '--remote') return sql;

  // D1 remote imports reject explicit top-level SQL transaction wrappers.
  // Trigger bodies still use BEGIN/END blocks, so only strip exact wrapper lines.
  return sql
    .split(/\r?\n/)
    .filter((line) => !/^\s*(BEGIN\s+TRANSACTION|COMMIT)\s*;\s*$/i.test(line))
    .join('\n')
    .trim();
}

try {
  for (const file of files) {
    const path = join(dir, file);
    const sql = prepareSqlForMode(readFileSync(path, 'utf-8').trim());
    if (!sql) { console.log(`Skipping empty ${file}`); continue; }
    console.log(`Applying ${path} (${mode})`);

    const tmpFile = join(tmpDir, file);
    writeFileSync(tmpFile, sql, 'utf-8');

    try {
      execSync(`npx wrangler d1 execute ${dbName} ${mode} --file "${tmpFile}"`, { stdio: 'inherit' });
    } catch (err) {
      failures++;
      if (continueOnError) {
        console.warn(`  ⚠ ${file} failed (continuing): ${(err as Error).message?.split('\n')[0]}`);
      } else {
        throw err;
      }
    }
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.warn(`\n${failures} migration(s) had errors.`);
  if (!continueOnError) process.exit(1);
}
