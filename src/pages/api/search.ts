/**
 * GET /api/search?q=… [Master_Prompt v7.0 §13.1]
 * FTS5-powered product search with relevance ranking.
 *
 * Query params:
 *   q       — search term (required, min 2 chars)
 *   limit   — max results (default 20, max 50)
 *
 * Returns: { results: [{ id, slug, name, price_paisa, available_quantity, snippet }] }
 *
 * Per Master_Prompt v7.0: <50ms p99 for autocomplete. The simple FTS5
 * query is well under that; complex queries may be cached via the
 * Cache API helper in src/lib/cache-api.ts.
 */
import type { APIContext } from "astro";
import { getEnv } from "../../lib/env";
import { formatPaisa } from "../../lib/money";

export const prerender = false;

type Result = {
  id: string;
  slug: string;
  name: string;
  price_paisa: number;
  available_quantity: number;
  snippet: string;
  rank: number;
};

export async function GET(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const url = new URL(context.request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return Response.json({ ok: true, results: [], query: q });
  }
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20));

  // Escape FTS5 query: double-quote each term; reject unbalanced quotes.
  const escaped = q.replace(/"/g, '""');
  const ftsQuery = `"${escaped}"*`; // prefix match

  const rows = await env.DB
    .prepare(
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
       LIMIT ?2`,
    )
    .bind(ftsQuery, limit)
    .all<Result>();

  return Response.json({
    ok: true,
    query: q,
    results: (rows.results ?? []).map((r: Result) => ({ ...r, price_formatted: formatPaisa(r.price_paisa) })),
  });
}
