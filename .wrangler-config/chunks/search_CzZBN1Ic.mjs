globalThis.process ??= {};
globalThis.process.env ??= {};
import { g as getEnv } from "./env_BNqnkDbh.mjs";
import { f as formatPaisa } from "./money_DWLDQpFs.mjs";
const META_PREFIX = "ac:meta:";
const PRODUCT_PREFIX = "ac:product:";
function triGrams(s) {
  const norm = s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const words = norm.split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of words) {
    for (let i = 0; i < w.length - 2; i++) out.push(w.slice(i, i + 3));
    out.push(w);
  }
  return out;
}
async function autocomplete(env, q, limit = 8) {
  if (q.length < 1) return [];
  const grams = triGrams(q);
  const matches = /* @__PURE__ */ new Map();
  for (const g of grams) {
    const list = await env.CACHE.get(`${META_PREFIX}${g}`, "json").catch(() => null);
    if (!list) continue;
    for (const id of list) matches.set(id, (matches.get(id) ?? 0) + 1);
  }
  const ranked = Array.from(matches.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit);
  const out = [];
  for (const [id] of ranked) {
    const p = await env.CACHE.get(`${PRODUCT_PREFIX}${id}`, "json").catch(() => null);
    if (p) out.push(p);
  }
  return out;
}
const prerender = false;
async function GET(context) {
  const env = getEnv();
  const url = new URL(context.request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return Response.json({ ok: true, results: [], query: q });
  }
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20));
  const escaped = q.replace(/"/g, '""');
  const ftsQuery = `"${escaped}"*`;
  const rows = await env.DB.prepare(
    `SELECT p.id, p.slug, p.name, p.price_paisa,
              COALESCE((SELECT quantity - reserved_quantity FROM inventory_items ii WHERE ii.variant_id IN
                        (SELECT id FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_deleted = 0 LIMIT 1)), 0) AS available_quantity,
              snippet(products_fts, 1, '<mark>', '</mark>', '…', 16) AS snippet,
              bm25(products_fts) AS rank
       FROM products_fts
       JOIN products p ON p.rowid = products_fts.rowid
       WHERE products_fts MATCH ?1
         AND p.status = 'published'
       ORDER BY rank
       LIMIT ?2`
  ).bind(ftsQuery, limit).all();
  return Response.json({
    ok: true,
    query: q,
    results: (rows.results ?? []).map((r) => ({ ...r, price_formatted: formatPaisa(r.price_paisa) }))
  });
}
async function _autocompleteHandler(context) {
  const env = getEnv();
  const url = new URL(context.request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 1) return Response.json({ ok: true, results: [] });
  const results = await autocomplete({ CACHE: env.CACHE }, q, 8);
  return Response.json({ ok: true, results });
}
const _page = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  GET,
  _autocompleteHandler,
  prerender
}, Symbol.toStringTag, { value: "Module" }));
const page = () => _page;
export {
  page
};
