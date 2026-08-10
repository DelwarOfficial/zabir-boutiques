/**
 * Vite plugin: post-build, compute SHA-256 hashes of:
 *   1. Every emitted JS file under dist/client/_astro (Astro build output).
 *   2. Every inline script block (script tag with is:inline) in the
 *      src/pages, src/components, src/layouts, and src/islands trees.
 *      P1-005 audit fix: the previous version only hashed the build
 *      output, which meant inline scripts emitted directly in page
 *      source were not in the hash list and were blocked by the
 *      per-request CSP.
 *   3. N-13: every literal `style="..."` attribute value in the .astro
 *      source trees (script-src's exact mechanism, applied to style-src
 *      via CSP3's `'unsafe-hashes'` source expression, which allow-lists
 *      inline event-handler AND style attributes by hash — unlike a
 *      `<style>` block hash, which only covers `<style>` tag content, not
 *      the `style="..."` HTML attribute). Only literal, double/single
 *      quoted `style="..."` attributes are hashable this way — Astro's
 *      templating never allows `{expr}` interpolation inside a quoted
 *      attribute, so every match here is guaranteed static, byte-for-byte
 *      identical between build and runtime. Dynamic inline styles (a .tsx
 *      island's `style={{...}}` object, or any `style={...}` computed at
 *      render time) can't be hashed at build time and are NOT collected
 *      here — those need converting to a CSS class/custom-property
 *      instead, tracked separately.
 *
 * Embed the combined hash list into a TypeScript module under
 * src/generated/csp-hashes.ts so the Worker can include them in the
 * Content-Security-Policy script-src/style-src at runtime.
 *
 * The runtime cannot use node:fs (Workers runtime), so the hash list
 * is compiled into the Worker bundle. Middleware reads the generated
 * module directly.
 *
 * Ship-dark (N-13, phase 1): CSP_STYLE_HASHES is generated and exported
 * here, but src/lib/security/csp.ts does not consume it yet — style-src
 * still reads `'self' 'unsafe-inline'` only. Wiring it in is a deliberate
 * follow-up deploy once hash coverage is confirmed complete (see
 * docs/audit/N-13-CSP-STYLE-HASH-DESIGN.md), not bundled with this change.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";

const ASTRO_DIR = "dist/client/_astro";
const SOURCE_DIRS = ["src/pages", "src/components", "src/layouts", "src/islands"];
const OUTPUT_TS = "src/generated/csp-hashes.ts";

function sha256Base64(buf) {
  return "'sha256-" + createHash("sha256").update(buf).digest("base64") + "'";
}

function collectScripts(root) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, entry.name);
    if (entry.isDirectory()) out.push(...collectScripts(p));
    else if (extname(entry.name) === ".js") out.push(p);
  }
  return out;
}

const SCRIPT_BLOCK_RE = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

function collectInlineScriptHashes(root) {
  if (!existsSync(root)) return [];
  const hashes = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, entry.name);
    if (entry.isDirectory()) {
      hashes.push(...collectInlineScriptHashes(p));
    } else if (extname(entry.name) === ".astro") {
      const source = readFileSync(p, "utf8");
      // Reset regex state for each file
      SCRIPT_BLOCK_RE.lastIndex = 0;
      let match;
      while ((match = SCRIPT_BLOCK_RE.exec(source)) !== null) {
        const body = match[1].trim();
        if (!body) continue;
        // Hash the raw inner content. Browsers hash the *executed* script
        // text, which for a <script>block is the inner HTML — the same
        // bytes that appear in the served page.
        hashes.push(sha256Base64(Buffer.from(body, "utf8")));
      }
    }
  }
  return hashes;
}

// Matches a literal, quoted `style="..."` or `style='...'` HTML attribute.
// Deliberately does NOT match `style={...}` (Astro/JSX expression syntax —
// dynamic, unhashable) since the alternation requires an immediate quote
// character right after `=`.
const STYLE_ATTR_RE = /\sstyle=(?:"([^"]*)"|'([^']*)')/g;

export function collectStyleAttrHashes(root) {
  if (!existsSync(root)) return [];
  const hashes = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, entry.name);
    if (entry.isDirectory()) {
      hashes.push(...collectStyleAttrHashes(p));
    } else if (extname(entry.name) === ".astro") {
      const source = readFileSync(p, "utf8");
      STYLE_ATTR_RE.lastIndex = 0;
      let match;
      while ((match = STYLE_ATTR_RE.exec(source)) !== null) {
        const value = match[1] ?? match[2] ?? "";
        if (!value.trim()) continue;
        // The browser hashes the exact attribute value string (as parsed
        // from the DOM), which for a literal quoted attribute is the same
        // bytes that appear between the quotes in the served HTML.
        hashes.push(sha256Base64(Buffer.from(value, "utf8")));
      }
    }
  }
  return hashes;
}

function buildScriptHashes() {
  const hashes = new Set();
  for (const file of collectScripts(ASTRO_DIR)) {
    const content = readFileSync(file);
    hashes.add(sha256Base64(content));
  }
  for (const dir of SOURCE_DIRS) {
    for (const h of collectInlineScriptHashes(dir)) {
      hashes.add(h);
    }
  }
  return Array.from(hashes);
}

function buildStyleHashes() {
  const hashes = new Set();
  for (const dir of SOURCE_DIRS) {
    for (const h of collectStyleAttrHashes(dir)) {
      hashes.add(h);
    }
  }
  return Array.from(hashes);
}

export default function cspHashes() {
  return {
    name: "csp-hashes",
    apply: "build",
    closeBundle() {
      try {
        const scriptHashes = buildScriptHashes();
        const styleHashes = buildStyleHashes();
        const version = new Date().toISOString();
        mkdirSync("src/generated", { recursive: true });
        writeFileSync(
          OUTPUT_TS,
          `// AUTO-GENERATED by scripts/csp-hashes-plugin.mjs. Do not edit.\n` +
            `// Generated at ${version}.\n` +
            `export const CSP_SCRIPT_HASHES: readonly string[] = ${JSON.stringify(scriptHashes, null, 2)};\n` +
            `export const CSP_SCRIPT_HASHES_VERSION: string = ${JSON.stringify(version)};\n` +
            `export const CSP_STYLE_HASHES: readonly string[] = ${JSON.stringify(styleHashes, null, 2)};\n` +
            `export const CSP_STYLE_HASHES_VERSION: string = ${JSON.stringify(version)};\n`,
        );
        console.info(`[csp-hashes] wrote ${scriptHashes.length} script hash(es), ${styleHashes.length} style hash(es) to ${OUTPUT_TS}`);
      } catch (err) {
        console.warn("[csp-hashes] failed:", err);
      }
    },
  };
}
