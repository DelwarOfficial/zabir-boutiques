globalThis.process ??= {};
globalThis.process.env ??= {};
import { n as nowSql } from "./sequence_XySMyPne.mjs";
const SITE = (typeof PUBLIC_SITE_URL !== "undefined" ? PUBLIC_SITE_URL : void 0) ?? "https://zabirboutiques.com";
function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
async function generateSitemap(db, _media) {
  const products = await db.prepare("SELECT slug, updated_at FROM products WHERE status = 'published'").all();
  const categories = await db.prepare("SELECT slug, updated_at FROM categories WHERE is_active = 1").all();
  const urls = [];
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
  await db.prepare(
    `INSERT OR REPLACE INTO sitemap_metadata (id, url, last_modified, priority, change_frequency)
       VALUES ('current', ?1, ?2, 1.0, 'daily')`
  ).bind(xml, nowSql()).run();
  return { urls: urls.length };
}
export {
  generateSitemap
};
