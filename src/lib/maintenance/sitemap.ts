/**
 * Sitemap Generator [Master_Prompt v7.0 §11.4, Phase 4]
 *
 * Daily cron builds a sitemap.xml from the D1 catalog and writes
 * it to R2 under /sitemap.xml. Astro's static site can then serve
 * it from /sitemap.xml via the assets binding.
 *
 * Sitemap index splits at 50,000 URLs per file (per spec). We don't
 * anticipate that scale; a single file is enough for now.
 *
 * P0-008 audit fix: previous version built the XML and then never
 * wrote it to R2 — only to the sitemap_metadata D1 table. The R2
 * path is now actually executed.
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
  media: R2Bucket | undefined,
): Promise<{ urls: number; r2Key?: string }> {
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

  // P0-008: actually write to R2. The MEDIA binding is the storefront's
  // R2 bucket, so writing to it makes sitemap.xml directly servable.
  let r2Key: string | undefined;
  if (media) {
    r2Key = "sitemap.xml";
    await media.put(r2Key, xml, {
      httpMetadata: { contentType: "application/xml" },
      customMetadata: { urlCount: String(urls.length), generatedAt: nowSql() },
    });
  }

  // Mirror to D1 for the /sitemap.xml fallback endpoint.
  await db
    .prepare(
      `INSERT OR REPLACE INTO sitemap_metadata (id, url, last_modified, priority, change_frequency)
       VALUES ('current', ?1, ?2, 1.0, 'daily')`,
    )
    .bind(xml, nowSql())
    .run();
  return { urls: urls.length, r2Key };
}
