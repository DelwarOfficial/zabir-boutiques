/**
 * Core Web Vitals Budget [Master_Prompt v7.0 §2.8, Phase 3.5]
 *
 * Runs Lighthouse-style audits against the local preview server
 * and asserts the budgets in scripts/cwv-budget.config.json. In a
 * CI environment we'd shell out to the Lighthouse CLI; for local
 * + small-CI use, we approximate the budgets by reading:
 *
 *   - The SSR HTML size for the product detail page (proxy for
 *     LCP — large HTMLs typically mean more work before the LCP
 *     element paints).
 *   - The number of inline <script> blocks (proxy for CLS risk
 *     and for hydration-related INP).
 *   - The set of resources that block paint
 *     (render-blocking JS/CSS in <head>).
 *
 * Real Lighthouse runs are scheduled weekly via the Cloudflare
 * Pages deploy previews (per the deploy hook in
 * docs/zero-trust.md and Master_Prompt v7.0 §3.5). This script is
 * a fast inner-loop guard for engineers.
 */
import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const CONFIG = JSON.parse(readFileSync("scripts/cwv-budget.config.json", "utf8"));
const PREVIEW_URL = process.env.CWV_PREVIEW_URL ?? "http://localhost:4321";
const PATHS = (CONFIG.paths ?? ["/", "/categories/saree", "/products/saree-1"]).slice(0, 10);

async function fetchOnce(path) {
  const url = `${PREVIEW_URL}${path}`;
  const t0 = performance.now();
  const res = await fetch(url, { redirect: "follow" });
  const buf = new Uint8Array(await res.arrayBuffer());
  const elapsed = performance.now() - t0;
  return { url, status: res.status, html: new TextDecoder().decode(buf), size: buf.length, elapsedMs: elapsed };
}

function metricsOf({ html, size, elapsedMs }) {
  const inlineScripts = (html.match(/<script(?![^>]*src=)/g) ?? []).length;
  const renderBlockingLinks = (html.match(/<link[^>]*rel=["']stylesheet["'][^>]*>/g) ?? []).length;
  const hasLcp = /fetchpriority=["']high["']/.test(html);
  const hasSrcset = /srcset=/.test(html);
  return { size, inlineScripts, renderBlockingLinks, hasLcp, hasSrcset, elapsedMs };
}

let exitCode = 0;
const rows = [];
for (const path of PATHS) {
  try {
    const r = await fetchOnce(path);
    const m = metricsOf(r);
    const failures = [];
    if (m.size > CONFIG.maxHtmlBytes) failures.push(`html size ${m.size} > ${CONFIG.maxHtmlBytes}`);
    if (m.inlineScripts > CONFIG.maxInlineScripts) failures.push(`inline scripts ${m.inlineScripts} > ${CONFIG.maxInlineScripts}`);
    if (m.renderBlockingLinks > CONFIG.maxRenderBlockingLinks) failures.push(`render-blocking ${m.renderBlockingLinks} > ${CONFIG.maxRenderBlockingLinks}`);
    if (CONFIG.requireLcpHint && !m.hasLcp) failures.push("missing fetchpriority=high on LCP image");
    if (CONFIG.requireSrcset && !m.hasSrcset) failures.push("missing srcset on <img>");
    rows.push({ path, ...m, failures });
    if (failures.length > 0) exitCode = 1;
  } catch (err) {
    console.error(`[cwv] failed to fetch ${path}:`, err);
    exitCode = 1;
  }
}
console.table(rows);
if (exitCode !== 0) {
  console.error("[cwv] BUDGET VIOLATIONS — see table above");
}
process.exit(exitCode);
