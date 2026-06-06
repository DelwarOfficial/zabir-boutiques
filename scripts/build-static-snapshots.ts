/**
 * Build-Time D1 Access Strategy [v6.8A]
 * SSG pages use build-time snapshots created by a prebuild script
 * that calls the D1 REST API with a scoped read-only token.
 *
 * Required env vars: CF_ACCOUNT_ID, CF_D1_DATABASE_ID, CF_D1_READ_TOKEN
 * Generated src/data/*.json files are build artifacts and must be gitignored.
 * If snapshot generation fails, build must fail.
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const ACCOUNT = process.env.CF_ACCOUNT_ID;
const DB_ID = process.env.CF_D1_DATABASE_ID;
const TOKEN = process.env.CF_D1_READ_TOKEN;

if (!ACCOUNT || !DB_ID || !TOKEN) {
  console.error('[snapshots] Missing required env vars: CF_ACCOUNT_ID, CF_D1_DATABASE_ID, CF_D1_READ_TOKEN');
  console.error('[snapshots] Build failing — snapshots required for production deployment.');
  process.exit(1);
}

const BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB_ID}/query`;

async function d1Query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params })
  });
  const json = await res.json() as any;
  if (!json.success) throw new Error(`D1 REST error: ${JSON.stringify(json.errors)}`);
  return json.result?.[0]?.results as T[] ?? [];
}

mkdirSync('./src/data', { recursive: true });

const categories = await d1Query(
  `SELECT c.slug, c.name, p.slug AS parent_slug, c.meta_title, c.meta_description
   FROM categories c
   LEFT JOIN categories p ON p.id = c.parent_id
   WHERE c.is_active = 1
   ORDER BY c.sort_order ASC`
);

const products = await d1Query(
  `SELECT
     p.id,
     p.slug,
     p.name,
     parent.slug AS category_slug,
     c.slug AS subcategory_slug,
     COALESCE(v.price_paisa, p.price_paisa) AS price_paisa,
     COALESCE('/cdn-cgi/image/fit=cover,width=512/' || pi.r2_key, NULL) AS image_url,
     v.id AS variant_id,
     COALESCE(NULLIF(TRIM(COALESCE(v.size, '') || CASE WHEN v.size IS NOT NULL AND v.color IS NOT NULL THEN ' / ' ELSE '' END || COALESCE(v.color, '')), ''), v.sku) AS variant_label,
     MAX(0, COALESCE(i.quantity, 0) - COALESCE(i.reserved_quantity, 0)) AS available_quantity
   FROM products p
   JOIN categories c ON c.id = p.category_id
   LEFT JOIN categories parent ON parent.id = c.parent_id
   JOIN product_variants v ON v.product_id = p.id AND v.is_deleted = 0
   LEFT JOIN inventory_items i ON i.variant_id = v.id
   LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.sort_order = 0
   WHERE p.status = 'published'
   GROUP BY p.id
   ORDER BY p.created_at DESC`
);

if (categories.length === 0) throw new Error('Snapshot failed: zero active categories');
if (products.length === 0) throw new Error('Snapshot failed: zero published products');

writeFileSync('./src/data/categories-snapshot.json', JSON.stringify(categories, null, 2));
writeFileSync('./src/data/products-snapshot.json', JSON.stringify(products, null, 2));

console.log(`[snapshots] Generated ${categories.length} categories, ${products.length} products`);
