/**
 * GET /robots.txt [Master_Prompt v7.0 §20.4]
 */
export const prerender = true;

export async function GET() {
  const robots = `User-agent: *
Allow: /
Allow: /products/
Allow: /categories/
Allow: /collections/
Allow: /blog/
Allow: /about
Allow: /privacy
Allow: /terms
Allow: /return-policy
Allow: /size-guide

Disallow: /api/
Disallow: /staff/
Disallow: /checkout
Disallow: /cart
Disallow: /buy-now/

Sitemap: https://zabirboutiques.com/sitemap.xml
`;
  return new Response(robots, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
