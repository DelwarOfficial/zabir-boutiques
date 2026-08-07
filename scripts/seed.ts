const STAFF = {
  email: 'admin@zabirboutiques.com',
  phone: '+8801712345678',
  password: 'JOurNameList21',
  passwordSalt: 'aa4027bb393ac1163d120a3dd2ad020d',
  full_name: 'Admin User',
  role: 'super_admin'
};
STAFF['passwordHash'] = 'f6cc44c20862b8d4febb6200ebbb72bd529cb3acbbe99d893da5770ae3ce4e4a';

const CATEGORIES = [
  { id: 'a1000000-0000-4000-8000-000000000001', name: 'Pakistani Collection', slug: 'pakistani-collection', sort_order: 1 },
  { id: 'a1000000-0000-4000-8000-000000000002', name: 'Indian Collection', slug: 'indian-collection', sort_order: 2 },
  { id: 'a1000000-0000-4000-8000-000000000003', name: 'ZB Stitch', slug: 'zb-stitch', sort_order: 3 },
  { id: 'a1000000-0000-4000-8000-000000000004', name: 'Jewelry', slug: 'jewelry', sort_order: 4 },
  { id: 'a1000000-0000-4000-8000-000000000005', name: 'Bags', slug: 'bags', sort_order: 5 },
];

const PRODUCTS = [
  { id: 'b2000000-0000-4000-8000-000000000001', name: 'Bin Sayed Three-Piece', slug: 'bin-sayed-three-piece', category_idx: 0, price: 499900, compare: 699900 },
  { id: 'b2000000-0000-4000-8000-000000000002', name: 'Indian Georgette Three-Piece', slug: 'indian-georgette-three-piece', category_idx: 1, price: 399900, compare: 549900 },
  { id: 'b2000000-0000-4000-8000-000000000003', name: 'ZB Kurti Collection', slug: 'zb-kurti-collection', category_idx: 2, price: 249900, compare: 349900 },
  { id: 'b2000000-0000-4000-8000-000000000004', name: 'Bridal Jewelry Set', slug: 'bridal-jewelry-set', category_idx: 3, price: 899900, compare: null },
];

interface Product {
  id: string; name: string; slug: string; category_idx: number; price: number; compare: number | null;
}

function generateSQL(): string {
  const now = '2026-06-04 00:00:00';
  let sql = '-- Zabir Boutiques v6.8A Seed Data\n';
  // Use fixed UUIDs for all seed rows so re-seed is idempotent
  const STAFF_ID = '59cd9624-966b-4930-a6a0-db3707c904ab';
  sql += `INSERT OR REPLACE INTO staff_users (id, email, phone, password_hash, password_salt, full_name, role, is_active, created_at, updated_at)\n`;
  sql += `  VALUES ('${STAFF_ID}', '${STAFF.email}', '${STAFF.phone}', '${STAFF.passwordHash}', '${STAFF.passwordSalt}', '${STAFF.full_name}', '${STAFF.role}', 1, '${now}', '${now}');\n\n`;

  for (const cat of CATEGORIES) {
    sql += `INSERT OR REPLACE INTO categories (id, name, slug, sort_order, is_active, created_at, updated_at)\n`;
    sql += `  VALUES ('${cat.id}', '${cat.name}', '${cat.slug}', ${cat.sort_order}, 1, '${now}', '${now}');\n`;
  }

  sql += '\n';

  for (const [pi, prod] of PRODUCTS.entries()) {
    const comp = prod.compare !== null ? prod.compare.toString() : 'NULL';
    sql += `INSERT OR REPLACE INTO products (id, name, slug, description, category_id, price_paisa, compare_price_paisa, status, is_featured, created_at, updated_at)\n`;
    sql += `  VALUES ('${prod.id}', '${prod.name}', '${prod.slug}', '${prod.name} - premium quality', '${CATEGORIES[prod.category_idx].id}', ${prod.price}, ${comp}, 'published', 1, '${now}', '${now}');\n`;

    const variantId = `c3000000-0000-4000-8000-0000000000${String(pi + 1).padStart(2, '0')}`;
    const sku = prod.slug.toUpperCase().replace(/-/g, '_');
    sql += `INSERT OR REPLACE INTO product_variants (id, product_id, sku, size, price_paisa, created_at, updated_at)\n`;
    sql += `  VALUES ('${variantId}', '${prod.id}', '${sku}', 'M', ${prod.price}, '${now}', '${now}');\n`;

    const inventoryId = `d4000000-0000-4000-8000-0000000000${String(pi + 1).padStart(2, '0')}`;
    sql += `INSERT OR REPLACE INTO inventory_items (id, variant_id, quantity, reserved_quantity, is_available, updated_at)\n`;
    sql += `  VALUES ('${inventoryId}', '${variantId}', 100, 0, 1, '${now}');\n`;

    const imgId = `e5000000-0000-4000-8000-0000000000${String(pi + 1).padStart(2, '0')}`;
    const r2Key = `products/${prod.id}/main.jpg`;
    sql += `INSERT OR REPLACE INTO product_images (id, product_id, r2_key, is_compressed, sort_order, created_at, updated_at)\n`;
    sql += `  VALUES ('${imgId}', '${prod.id}', '${r2Key}', 0, 0, '${now}', '${now}');\n`;
  }

  sql += `\nINSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES ('seed_data', '${now}');\n`;
  return sql;
}

const fs = await import('node:fs');
fs.writeFileSync('./db/seed.sql', generateSQL());
console.log('[seed] Generated db/seed.sql with sample data');
console.log(`[seed] Staff login: ${STAFF.email} / ${STAFF.password}`);
console.log(`[seed] To apply: wrangler d1 execute zabir-db --remote --file=db/seed.sql`);
