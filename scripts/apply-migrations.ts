import { readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const mode = process.argv.includes('--remote') ? '--remote' : '--local';
const dbName = process.env.D1_DATABASE ?? 'zabir-db';
const dir = 'db/migrations';

const files = readdirSync(dir)
  .filter((file) => /^\d{4}_.+\.sql$/.test(file))
  .sort();

for (const file of files) {
  const path = join(dir, file);
  console.log(`Applying ${path} (${mode})`);
  execSync(`npx wrangler d1 execute ${dbName} ${mode} --file="${path}"`, { stdio: 'inherit' });
}
