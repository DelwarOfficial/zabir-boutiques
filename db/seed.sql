-- Zabir Boutiques v6.8A Seed Data
INSERT OR REPLACE INTO staff_users (id, email, phone, password_hash, password_salt, full_name, role, is_active, created_at, updated_at)
  VALUES ('59cd9624-966b-4930-a6a0-db3707c904ab', 'admin@zabrboutiques.com', '+8801712345678', '702e6c3b311230ab18a946e1f78bbea8fad74d4740b7b8f56bcd92cc9bc9adbc', '35cd27de985f3408d68ec4e7c1d264bc', 'Admin User', 'super_admin', 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');

INSERT OR REPLACE INTO categories (id, name, slug, sort_order, is_active, created_at, updated_at)
  VALUES ('a1000000-0000-4000-8000-000000000001', 'Pakistani Collection', 'pakistani-collection', 1, 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR REPLACE INTO categories (id, name, slug, sort_order, is_active, created_at, updated_at)
  VALUES ('a1000000-0000-4000-8000-000000000002', 'Indian Collection', 'indian-collection', 2, 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR REPLACE INTO categories (id, name, slug, sort_order, is_active, created_at, updated_at)
  VALUES ('a1000000-0000-4000-8000-000000000003', 'ZB Stitch', 'zb-stitch', 3, 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR REPLACE INTO categories (id, name, slug, sort_order, is_active, created_at, updated_at)
  VALUES ('a1000000-0000-4000-8000-000000000004', 'Jewelry', 'jewelry', 4, 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR REPLACE INTO categories (id, name, slug, sort_order, is_active, created_at, updated_at)
  VALUES ('a1000000-0000-4000-8000-000000000005', 'Bags', 'bags', 5, 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');

INSERT OR REPLACE INTO products (id, name, slug, description, category_id, price_paisa, compare_price_paisa, status, is_featured, created_at, updated_at)
  VALUES ('b2000000-0000-4000-8000-000000000001', 'Bin Sayed Three-Piece', 'bin-sayed-three-piece', 'Bin Sayed Three-Piece - premium quality', 'a1000000-0000-4000-8000-000000000001', 499900, 699900, 'published', 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR REPLACE INTO product_variants (id, product_id, sku, size, price_paisa, created_at, updated_at)
  VALUES ('c3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'BIN_SAYED_THREE_PIECE', 'M', 499900, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR REPLACE INTO inventory_items (id, variant_id, quantity, reserved_quantity, is_available, updated_at)
  VALUES ('d4000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 100, 0, 1, '2026-06-04 00:00:00');
INSERT OR REPLACE INTO product_images (id, product_id, r2_key, is_compressed, sort_order, created_at, updated_at)
  VALUES ('e5000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'products/b2000000-0000-4000-8000-000000000001/main.jpg', 0, 0, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR REPLACE INTO products (id, name, slug, description, category_id, price_paisa, compare_price_paisa, status, is_featured, created_at, updated_at)
  VALUES ('b2000000-0000-4000-8000-000000000002', 'Indian Georgette Three-Piece', 'indian-georgette-three-piece', 'Indian Georgette Three-Piece - premium quality', 'a1000000-0000-4000-8000-000000000002', 399900, 549900, 'published', 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR REPLACE INTO product_variants (id, product_id, sku, size, price_paisa, created_at, updated_at)
  VALUES ('c3000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002', 'INDIAN_GEORGETTE_THREE_PIECE', 'M', 399900, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR REPLACE INTO inventory_items (id, variant_id, quantity, reserved_quantity, is_available, updated_at)
  VALUES ('d4000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000002', 100, 0, 1, '2026-06-04 00:00:00');
INSERT OR REPLACE INTO product_images (id, product_id, r2_key, is_compressed, sort_order, created_at, updated_at)
  VALUES ('e5000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002', 'products/b2000000-0000-4000-8000-000000000002/main.jpg', 0, 0, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR REPLACE INTO products (id, name, slug, description, category_id, price_paisa, compare_price_paisa, status, is_featured, created_at, updated_at)
  VALUES ('b2000000-0000-4000-8000-000000000003', 'ZB Kurti Collection', 'zb-kurti-collection', 'ZB Kurti Collection - premium quality', 'a1000000-0000-4000-8000-000000000003', 249900, 349900, 'published', 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR REPLACE INTO product_variants (id, product_id, sku, size, price_paisa, created_at, updated_at)
  VALUES ('c3000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000003', 'ZB_KURTI_COLLECTION', 'M', 249900, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR REPLACE INTO inventory_items (id, variant_id, quantity, reserved_quantity, is_available, updated_at)
  VALUES ('d4000000-0000-4000-8000-000000000003', 'c3000000-0000-4000-8000-000000000003', 100, 0, 1, '2026-06-04 00:00:00');
INSERT OR REPLACE INTO product_images (id, product_id, r2_key, is_compressed, sort_order, created_at, updated_at)
  VALUES ('e5000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000003', 'products/b2000000-0000-4000-8000-000000000003/main.jpg', 0, 0, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR REPLACE INTO products (id, name, slug, description, category_id, price_paisa, compare_price_paisa, status, is_featured, created_at, updated_at)
  VALUES ('b2000000-0000-4000-8000-000000000004', 'Bridal Jewelry Set', 'bridal-jewelry-set', 'Bridal Jewelry Set - premium quality', 'a1000000-0000-4000-8000-000000000004', 899900, NULL, 'published', 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR REPLACE INTO product_variants (id, product_id, sku, size, price_paisa, created_at, updated_at)
  VALUES ('c3000000-0000-4000-8000-000000000004', 'b2000000-0000-4000-8000-000000000004', 'BRIDAL_JEWELRY_SET', 'M', 899900, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR REPLACE INTO inventory_items (id, variant_id, quantity, reserved_quantity, is_available, updated_at)
  VALUES ('d4000000-0000-4000-8000-000000000004', 'c3000000-0000-4000-8000-000000000004', 100, 0, 1, '2026-06-04 00:00:00');
INSERT OR REPLACE INTO product_images (id, product_id, r2_key, is_compressed, sort_order, created_at, updated_at)
  VALUES ('e5000000-0000-4000-8000-000000000004', 'b2000000-0000-4000-8000-000000000004', 'products/b2000000-0000-4000-8000-000000000004/main.jpg', 0, 0, '2026-06-04 00:00:00', '2026-06-04 00:00:00');

INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES ('seed_data', '2026-06-04 00:00:00');
