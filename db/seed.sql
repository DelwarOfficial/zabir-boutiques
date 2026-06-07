-- Zabir Boutiques v6.8A Seed Data
INSERT OR IGNORE INTO staff_users (id, email, phone, password_hash, full_name, role, is_active, created_at, updated_at)
  VALUES ('2e3ceb22-2576-4a38-b2eb-9acc6fac9b09', 'admin@zabirboutiques.com', '+8801712345678', '424e7811a66b4dd4bab7f86f231fd32a6a60512aefdd684843f6c70808bdc7ac', 'Admin User', 'super_admin', 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');

INSERT OR IGNORE INTO categories (id, name, slug, sort_order, is_active, created_at, updated_at)
  VALUES ('4de4bb70-9341-4a1f-a3b6-97bfb923487a', 'Pakistani Collection', 'pakistani-collection', 1, 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO categories (id, name, slug, sort_order, is_active, created_at, updated_at)
  VALUES ('7c85ade3-2d53-4698-a2ca-d40b4495e9f9', 'Indian Collection', 'indian-collection', 2, 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO categories (id, name, slug, sort_order, is_active, created_at, updated_at)
  VALUES ('c6fb40d0-d751-49d0-ab99-8280b2a796da', 'ZB Stitch', 'zb-stitch', 3, 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO categories (id, name, slug, sort_order, is_active, created_at, updated_at)
  VALUES ('f5d96ba0-e1b0-4f02-92e1-3eaf19130785', 'Jewelry', 'jewelry', 4, 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO categories (id, name, slug, sort_order, is_active, created_at, updated_at)
  VALUES ('2eda34bb-9c4f-48aa-a3be-34f42398d695', 'Bags', 'bags', 5, 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');

INSERT OR IGNORE INTO products (id, name, slug, description, category_id, price_paisa, compare_price_paisa, status, is_featured, created_at, updated_at)
  VALUES ('40861382-43c2-4624-b9b4-82ef3033dbc4', 'Bin Sayed Three-Piece', 'bin-sayed-three-piece', 'Bin Sayed Three-Piece - premium quality', '4de4bb70-9341-4a1f-a3b6-97bfb923487a', 499900, 699900, 'published', 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO product_variants (id, product_id, sku, size, price_paisa, created_at, updated_at)
  VALUES ('b1ee0e2b-dead-4cd0-a7c4-d66f364524d0', '40861382-43c2-4624-b9b4-82ef3033dbc4', 'BIN_SAYED_THREE_PIECE', 'M', 499900, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO inventory_items (id, variant_id, quantity, reserved_quantity, is_available, updated_at)
  VALUES ('cbfe9fe2-8236-4508-949a-a85392ed9cfe', 'b1ee0e2b-dead-4cd0-a7c4-d66f364524d0', 100, 0, 1, '2026-06-04 00:00:00');
INSERT OR IGNORE INTO product_images (id, product_id, r2_key, is_compressed, sort_order, created_at, updated_at)
  VALUES ('d1560b8c-ba69-46c2-9d35-90fd9d47339c', '40861382-43c2-4624-b9b4-82ef3033dbc4', 'products/40861382-43c2-4624-b9b4-82ef3033dbc4/main.jpg', 0, 0, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO products (id, name, slug, description, category_id, price_paisa, compare_price_paisa, status, is_featured, created_at, updated_at)
  VALUES ('67c53879-83e5-42b4-9aca-fbe26afe66b0', 'Indian Georgette Three-Piece', 'indian-georgette-three-piece', 'Indian Georgette Three-Piece - premium quality', '7c85ade3-2d53-4698-a2ca-d40b4495e9f9', 399900, 549900, 'published', 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO product_variants (id, product_id, sku, size, price_paisa, created_at, updated_at)
  VALUES ('123f8b14-9034-4d64-ad10-ca0a4eacfc4d', '67c53879-83e5-42b4-9aca-fbe26afe66b0', 'INDIAN_GEORGETTE_THREE_PIECE', 'M', 399900, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO inventory_items (id, variant_id, quantity, reserved_quantity, is_available, updated_at)
  VALUES ('ad060133-7d08-44f2-93cc-596942deb1ea', '123f8b14-9034-4d64-ad10-ca0a4eacfc4d', 100, 0, 1, '2026-06-04 00:00:00');
INSERT OR IGNORE INTO product_images (id, product_id, r2_key, is_compressed, sort_order, created_at, updated_at)
  VALUES ('ff9317bc-5b3e-41c6-b956-4fa1cbf31163', '67c53879-83e5-42b4-9aca-fbe26afe66b0', 'products/67c53879-83e5-42b4-9aca-fbe26afe66b0/main.jpg', 0, 0, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO products (id, name, slug, description, category_id, price_paisa, compare_price_paisa, status, is_featured, created_at, updated_at)
  VALUES ('18abd8fe-be42-491b-9d0b-23a7c5985653', 'ZB Kurti Collection', 'zb-kurti-collection', 'ZB Kurti Collection - premium quality', 'c6fb40d0-d751-49d0-ab99-8280b2a796da', 249900, 349900, 'published', 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO product_variants (id, product_id, sku, size, price_paisa, created_at, updated_at)
  VALUES ('6c664151-a852-438b-a107-c1e864e6dae6', '18abd8fe-be42-491b-9d0b-23a7c5985653', 'ZB_KURTI_COLLECTION', 'M', 249900, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO inventory_items (id, variant_id, quantity, reserved_quantity, is_available, updated_at)
  VALUES ('59e643be-06ea-4e0b-9dd3-71f756127372', '6c664151-a852-438b-a107-c1e864e6dae6', 100, 0, 1, '2026-06-04 00:00:00');
INSERT OR IGNORE INTO product_images (id, product_id, r2_key, is_compressed, sort_order, created_at, updated_at)
  VALUES ('9069a6ff-82e5-4783-8be6-7d119c9713a2', '18abd8fe-be42-491b-9d0b-23a7c5985653', 'products/18abd8fe-be42-491b-9d0b-23a7c5985653/main.jpg', 0, 0, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO products (id, name, slug, description, category_id, price_paisa, compare_price_paisa, status, is_featured, created_at, updated_at)
  VALUES ('7855e297-1b05-480f-9ca6-1bd168799038', 'Bridal Jewelry Set', 'bridal-jewelry-set', 'Bridal Jewelry Set - premium quality', 'f5d96ba0-e1b0-4f02-92e1-3eaf19130785', 899900, NULL, 'published', 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO product_variants (id, product_id, sku, size, price_paisa, created_at, updated_at)
  VALUES ('5c24d2f1-0b74-4523-8b05-af8201ece0b3', '7855e297-1b05-480f-9ca6-1bd168799038', 'BRIDAL_JEWELRY_SET', 'M', 899900, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO inventory_items (id, variant_id, quantity, reserved_quantity, is_available, updated_at)
  VALUES ('1fb6243d-b307-40a0-bf44-79ee5e9aa3ac', '5c24d2f1-0b74-4523-8b05-af8201ece0b3', 100, 0, 1, '2026-06-04 00:00:00');
INSERT OR IGNORE INTO product_images (id, product_id, r2_key, is_compressed, sort_order, created_at, updated_at)
  VALUES ('fa7051ce-8e58-4e76-b0bd-e7d0d1f9904e', '7855e297-1b05-480f-9ca6-1bd168799038', 'products/7855e297-1b05-480f-9ca6-1bd168799038/main.jpg', 0, 0, '2026-06-04 00:00:00', '2026-06-04 00:00:00');

INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES ('seed_data', '2026-06-04 00:00:00');
