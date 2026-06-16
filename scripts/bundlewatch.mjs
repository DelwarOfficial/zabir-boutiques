/**
 * Bundlewatch [Master_Prompt v7.0 §2.9, Phase 3.6]
 *
 * Walks dist/client/_astro and dist/client/_astro-islands, sums up
 * the raw + gzip size of every .js file, and compares to the budget
 * in scripts/bundlewatch.config.json. Exits non-zero on overage.
 *
 * Usage:
 *   node scripts/bundlewatch.mjs          # check
 *   node scripts/bundlewatch.mjs --update # write current sizes to config
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, extname } from "node:path";

const CONFIG_PATH = "scripts/bundlewatch.config.json";
const ROOTS = ["dist/client/_astro", "dist/client/_astro-islands"];

function* walk(root) {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (extname(entry.name) === ".js") yield p;
  }
}

function sizeOf(p) {
  const buf = readFileSync(p);
  return { raw: buf.length, gz: gzipSync(buf).length };
}

function buildReport() {
  const entries = [];
  let totalRaw = 0;
  let totalGz = 0;
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const { raw, gz } = sizeOf(file);
      entries.push({ file: file.replace(/\\/g, "/"), raw, gz });
      totalRaw += raw;
      totalGz += gz;
    }
  }
  entries.sort((a, b) => b.gz - a.gz);
  return { entries, totalRaw, totalGz };
}

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
const isUpdate = process.argv.includes("--update");
const { entries, totalRaw, totalGz } = buildReport();

const violations = [];
for (const e of entries) {
  const rule = config.files?.[e.file];
  if (rule?.maxGz && e.gz > rule.maxGz) {
    violations.push(`  - ${e.file}: ${e.gz}B gz > budget ${rule.maxGz}B`);
  }
}
if (config.total?.maxGz && totalGz > config.total.maxGz) {
  violations.push(`  - TOTAL: ${totalGz}B gz > budget ${config.total.maxGz}B`);
}

const summary = {
  totalFiles: entries.length,
  totalRawBytes: totalRaw,
  totalGzBytes: totalGz,
  top10: entries.slice(0, 10).map(e => ({ file: e.file, gz: e.gz })),
};

mkdirSync("dist", { recursive: true });
writeFileSync("dist/bundlewatch-report.json", JSON.stringify(summary, null, 2));

if (isUpdate) {
  // Update per-file budgets to current size + 5% headroom.
  const files = {};
  for (const e of entries) files[e.file] = { maxGz: Math.ceil(e.gz * 1.05) };
  config.files = files;
  config.total = { maxGz: Math.ceil(totalGz * 1.05) };
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  console.log(`[bundlewatch] updated ${CONFIG_PATH}`);
  process.exit(0);
}

if (violations.length > 0) {
  console.error("[bundlewatch] BUDGET VIOLATIONS:");
  for (const v of violations) console.error(v);
  process.exit(1);
}
console.log(`[bundlewatch] OK — ${entries.length} files, total ${totalGz}B gz`);
