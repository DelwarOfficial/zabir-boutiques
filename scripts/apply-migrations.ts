import { readdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const mode = process.argv.includes('--remote') ? '--remote' : '--local';
const dbName = process.env.D1_DATABASE ?? 'zabir-db';
const dir = 'db/migrations';
const continueOnError = process.argv.includes('--continue-on-error');

const files = readdirSync(dir)
  .filter((file) => /^\d{4}_.+\.sql$/.test(file))
  .sort();

let failures = 0;

for (const file of files) {
  const path = join(dir, file);
  const sql = readFileSync(path, 'utf-8').trim();
  if (!sql) { console.log(`Skipping empty ${file}`); continue; }
  console.log(`Applying ${path} (${mode})`);
  try {
    execSync(`npx wrangler d1 execute ${dbName} ${mode} --command ${JSON.stringify(sql)}`, { stdio: 'inherit' });
  } catch (err) {
    failures++;
    if (continueOnError) {
      console.warn(`  ⚠ ${file} failed (continuing): ${(err as Error).message?.split('\n')[0]}`);
    } else {
      throw err;
    }
  }
}

if (failures > 0) {
  console.warn(`\n${failures} migration(s) had errors.`);
  if (!continueOnError) process.exit(1);
}
