/**
 * GET /api/search?q=… [Master_Prompt v7.0 §13.1]
 * FTS5-powered product search with relevance ranking.
 *
 * Query params:
 *   q       — search term (required, min 2 chars)
 *   limit   — max results (default 20, max 50)
 *
 * Returns: { ok: true, results: [{ id, slug, title, pricePaisa, imageUrl, variantLabel }] }
 */
import type { APIContext } from "astro";
import { getEnv } from "../../lib/env";
import { formatPaisa } from "../../lib/money";

type DbResult = {
  id: string;
  slug: string;
  name: string;
  price_paisa: number;
  image_url: string | null;
  variant_label: string | null;
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

  try {
    const rows = await env.DB
      .prepare(
        `SELECT p.id, p.slug, p.name, p.price_paisa,
                (SELECT '/cdn-cgi/image/fit=cover,width=120/' || r2_key FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order ASC LIMIT 1) AS image_url,
                (SELECT size || ' / ' || color FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_deleted = 0 LIMIT 1) AS variant_label
         FROM products_fts
         JOIN products p ON p.rowid = products_fts.rowid
         WHERE products_fts MATCH ?1
           AND p.status = 'published'
         LIMIT ?2`,
      )
      .bind(ftsQuery, limit)
      .all<DbResult>();

    const products = (rows.results ?? []).map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.name,
      pricePaisa: r.price_paisa,
      imageUrl: r.image_url ?? '/assets/product-zb-stitch.svg',
      variantLabel: r.variant_label || 'One Size',
      priceFormatted: formatPaisa(r.price_paisa)
    }));

    return Response.json({
      ok: true,
      query: q,
      products, // Also return products key for the Search island
      results: products // Keep results key for backward compatibility
    });
  } catch (err) {
    return Response.json({ ok: false, error: 'Database search error' }, { status: 500 });
  }
}
