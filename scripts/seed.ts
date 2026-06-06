import { randomUUID } from 'node:crypto';

const STAFF = {
  id: randomUUID(),
  email: 'admin@zabirboutiques.com',
  phone: '+8801712345678',
  password: 'admin123',
  full_name: 'Admin User',
  role: 'super_admin'
};

const CATEGORIES = [
  { id: randomUUID(), name: 'Pakistani Collection', slug: 'pakistani-collection', sort_order: 1 },
  { id: randomUUID(), name: 'Indian Collection', slug: 'indian-collection', sort_order: 2 },
  { id: randomUUID(), name: 'ZB Stitch', slug: 'zb-stitch', sort_order: 3 },
  { id: randomUUID(), name: 'Jewelry', slug: 'jewelry', sort_order: 4 },
  { id: randomUUID(), name: 'Bags', slug: 'bags', sort_order: 5 },
];

const PRODUCTS = [
  { id: randomUUID(), name: 'Bin Sayed Three-Piece', slug: 'bin-sayed-three-piece', category_idx: 0, price: 499900, compare: 699900 },
  { id: randomUUID(), name: 'Indian Georgette Three-Piece', slug: 'indian-georgette-three-piece', category_idx: 1, price: 399900, compare: 549900 },
  { id: randomUUID(), name: 'ZB Kurti Collection', slug: 'zb-kurti-collection', category_idx: 2, price: 249900, compare: 349900 },
  { id: randomUUID(), name: 'Bridal Jewelry Set', slug: 'bridal-jewelry-set', category_idx: 3, price: 899900, compare: null },
];

interface Product {
  id: string; name: string; slug: string; category_idx: number; price: number; compare: number | null;
}

function generateSQL(): string {
  const now = '2026-06-04 00:00:00';
  let sql = '-- Zabir Boutiques v6.8A Seed Data\n';
  sql += `INSERT OR IGNORE INTO staff_users (id, email, phone, password_hash, full_name, role, is_active, created_at, updated_at)\n`;
  sql += `  VALUES ('${STAFF.id}', '${STAFF.email}', '${STAFF.phone}', '${STAFF.password}', '${STAFF.full_name}', '${STAFF.role}', 1, '${now}', '${now}');\n\n`;

  for (const cat of CATEGORIES) {
    sql += `INSERT OR IGNORE INTO categories (id, name, slug, sort_order, is_active, created_at, updated_at)\n`;
    sql += `  VALUES ('${cat.id}', '${cat.name}', '${cat.slug}', ${cat.sort_order}, 1, '${now}', '${now}');\n`;
  }

  sql += '\n';

  for (const prod of PRODUCTS) {
    const comp = prod.compare !== null ? prod.compare.toString() : 'NULL';
    sql += `INSERT OR IGNORE INTO products (id, name, slug, description, category_id, price_paisa, compare_price_paisa, status, is_featured, created_at, updated_at)\n`;
    sql += `  VALUES ('${prod.id}', '${prod.name}', '${prod.slug}', '${prod.name} - premium quality', '${CATEGORIES[prod.category_idx].id}', ${prod.price}, ${comp}, 'published', 1, '${now}', '${now}');\n`;

    const variantId = randomUUID();
    const sku = prod.slug.toUpperCase().replace(/-/g, '_');
    sql += `INSERT OR IGNORE INTO product_variants (id, product_id, sku, size, price_paisa, created_at, updated_at)\n`;
    sql += `  VALUES ('${variantId}', '${prod.id}', '${sku}', 'M', ${prod.price}, '${now}', '${now}');\n`;

    const inventoryId = randomUUID();
    sql += `INSERT OR IGNORE INTO inventory_items (id, variant_id, quantity, reserved_quantity, is_available, updated_at)\n`;
    sql += `  VALUES ('${inventoryId}', '${variantId}', 100, 0, 1, '${now}');\n`;

    const imgId = randomUUID();
    const r2Key = `products/${prod.id}/main.jpg`;
    sql += `INSERT OR IGNORE INTO product_images (id, product_id, r2_key, is_compressed, sort_order, created_at, updated_at)\n`;
    sql += `  VALUES ('${imgId}', '${prod.id}', '${r2Key}', 0, 0, '${now}', '${now}');\n`;
  }

  sql += `\nINSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES ('seed_data', '${now}');\n`;
  return sql;
}

const fs = await import('node:fs');
fs.writeFileSync('./db/seed.sql', generateSQL());
console.log('[seed] Generated db/seed.sql with sample data');
console.log(`[seed] Staff login: ${STAFF.email} / ${STAFF.password}`);
console.log(`[seed] To apply: wrangler d1 execute zabir-db --remote --file=db/seed.sql`);
