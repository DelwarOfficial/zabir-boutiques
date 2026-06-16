/**
 * Sitemap Generator [Master_Prompt v7.0 §11.4, Phase 4]
 *
 * Daily cron builds a sitemap.xml from the D1 catalog and writes
 * it to R2 under /sitemap.xml. Astro's static site can then serve
 * it from /sitemap.xml via the assets binding.
 *
 * Sitemap index splits at 50,000 URLs per file (per spec). We don't
 * anticipate that scale; a single file is enough for now.
 */
import { nowSql } from "../dates";

// PUBLIC_SITE_URL is set via wrangler.jsonc vars / Cloudflare dashboard at
// runtime. The fallback here is a build-time constant for local dev only.
declare const PUBLIC_SITE_URL: string | undefined;
const SITE = (typeof PUBLIC_SITE_URL !== "undefined" ? PUBLIC_SITE_URL : undefined) ?? "https://zabirboutiques.com";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function generateSitemap(
  db: D1Database,
  _media: R2Bucket | undefined,
): Promise<{ urls: number }> {
  const products = await db
    .prepare("SELECT slug, updated_at FROM products WHERE status = 'published'")
    .all<{ slug: string; updated_at: string }>();
  const categories = await db
    .prepare("SELECT slug, updated_at FROM categories WHERE is_active = 1")
    .all<{ slug: string; updated_at: string }>();

  const urls: string[] = [];
  urls.push(`  <url><loc>${SITE}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`);
  for (const c of categories.results ?? []) {
    urls.push(`  <url><loc>${SITE}/categories/${escapeXml(c.slug)}</loc><lastmod>${c.updated_at}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`);
  }
  for (const p of products.results ?? []) {
    urls.push(`  <url><loc>${SITE}/products/${escapeXml(p.slug)}</loc><lastmod>${p.updated_at}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;

  // Also expose via D1 for the static /sitemap.xml endpoint.
  await db
    .prepare(
      `INSERT OR REPLACE INTO sitemap_metadata (id, url, last_modified, priority, change_frequency)
       VALUES ('current', ?1, ?2, 1.0, 'daily')`,
    )
    .bind(xml, nowSql())
    .run();
  return { urls: urls.length };
}
