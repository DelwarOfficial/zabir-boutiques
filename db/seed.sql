-- Zabir Boutiques v6.8A Seed Data
INSERT OR IGNORE INTO staff_users (id, email, phone, password_hash, full_name, role, is_active, created_at, updated_at)
  VALUES ('59cd9624-966b-4930-a6a0-db3707c904ab', 'admin@zabirboutiques.com', '+8801712345678', 'admin123', 'Admin User', 'super_admin', 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');

INSERT OR IGNORE INTO categories (id, name, slug, sort_order, is_active, created_at, updated_at)
  VALUES ('e19f85e7-1d2d-4d6c-8e74-7c193723c461', 'Pakistani Collection', 'pakistani-collection', 1, 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO categories (id, name, slug, sort_order, is_active, created_at, updated_at)
  VALUES ('5f09cd29-85f9-4402-819d-0d3607b1502a', 'Indian Collection', 'indian-collection', 2, 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO categories (id, name, slug, sort_order, is_active, created_at, updated_at)
  VALUES ('ca99ffa1-6b50-46cb-b537-a5ce502ed939', 'ZB Stitch', 'zb-stitch', 3, 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO categories (id, name, slug, sort_order, is_active, created_at, updated_at)
  VALUES ('4e6d9a34-9454-4a7e-a5a3-fae9306fe383', 'Jewelry', 'jewelry', 4, 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO categories (id, name, slug, sort_order, is_active, created_at, updated_at)
  VALUES ('03457b8a-1794-46e6-94f9-bd08b26b7837', 'Bags', 'bags', 5, 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');

INSERT OR IGNORE INTO products (id, name, slug, description, category_id, price_paisa, compare_price_paisa, status, is_featured, created_at, updated_at)
  VALUES ('20249dd2-0f82-4257-9008-c5d4f4af85c6', 'Bin Sayed Three-Piece', 'bin-sayed-three-piece', 'Bin Sayed Three-Piece - premium quality', 'e19f85e7-1d2d-4d6c-8e74-7c193723c461', 499900, 699900, 'published', 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO product_variants (id, product_id, sku, size, price_paisa, created_at, updated_at)
  VALUES ('c4498253-8442-42e7-8b93-c1540d3ef1c1', '20249dd2-0f82-4257-9008-c5d4f4af85c6', 'BIN_SAYED_THREE_PIECE', 'M', 499900, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO inventory_items (id, variant_id, quantity, reserved_quantity, is_available, updated_at)
  VALUES ('0312c8ae-f1d5-4016-a54b-e4c8a1fd9e83', 'c4498253-8442-42e7-8b93-c1540d3ef1c1', 100, 0, 1, '2026-06-04 00:00:00');
INSERT OR IGNORE INTO product_images (id, product_id, r2_key, is_compressed, sort_order, created_at, updated_at)
  VALUES ('c16e9f41-0fdb-4311-8ad2-52ed1670fd12', '20249dd2-0f82-4257-9008-c5d4f4af85c6', 'products/20249dd2-0f82-4257-9008-c5d4f4af85c6/main.jpg', 0, 0, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO products (id, name, slug, description, category_id, price_paisa, compare_price_paisa, status, is_featured, created_at, updated_at)
  VALUES ('86f90a86-ae8e-4ccd-8149-74239ad70028', 'Indian Georgette Three-Piece', 'indian-georgette-three-piece', 'Indian Georgette Three-Piece - premium quality', '5f09cd29-85f9-4402-819d-0d3607b1502a', 399900, 549900, 'published', 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO product_variants (id, product_id, sku, size, price_paisa, created_at, updated_at)
  VALUES ('d05dd49c-fa20-4b28-9be5-24e55b2dc81e', '86f90a86-ae8e-4ccd-8149-74239ad70028', 'INDIAN_GEORGETTE_THREE_PIECE', 'M', 399900, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO inventory_items (id, variant_id, quantity, reserved_quantity, is_available, updated_at)
  VALUES ('4fc58768-725b-48df-a3f1-7614fe456c20', 'd05dd49c-fa20-4b28-9be5-24e55b2dc81e', 100, 0, 1, '2026-06-04 00:00:00');
INSERT OR IGNORE INTO product_images (id, product_id, r2_key, is_compressed, sort_order, created_at, updated_at)
  VALUES ('cf3381b2-d2eb-41a6-b498-f09783ffc166', '86f90a86-ae8e-4ccd-8149-74239ad70028', 'products/86f90a86-ae8e-4ccd-8149-74239ad70028/main.jpg', 0, 0, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO products (id, name, slug, description, category_id, price_paisa, compare_price_paisa, status, is_featured, created_at, updated_at)
  VALUES ('0e6317cf-8f28-4af4-84ea-5a4135cfebf5', 'ZB Kurti Collection', 'zb-kurti-collection', 'ZB Kurti Collection - premium quality', 'ca99ffa1-6b50-46cb-b537-a5ce502ed939', 249900, 349900, 'published', 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO product_variants (id, product_id, sku, size, price_paisa, created_at, updated_at)
  VALUES ('8bfb296b-9b18-4ee2-9bdd-7933fbfc3ea2', '0e6317cf-8f28-4af4-84ea-5a4135cfebf5', 'ZB_KURTI_COLLECTION', 'M', 249900, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO inventory_items (id, variant_id, quantity, reserved_quantity, is_available, updated_at)
  VALUES ('410fa3e3-3f0a-4937-aef1-ecdfa5c76c27', '8bfb296b-9b18-4ee2-9bdd-7933fbfc3ea2', 100, 0, 1, '2026-06-04 00:00:00');
INSERT OR IGNORE INTO product_images (id, product_id, r2_key, is_compressed, sort_order, created_at, updated_at)
  VALUES ('ee062ae0-2c2a-4857-8080-d8c2cac73e05', '0e6317cf-8f28-4af4-84ea-5a4135cfebf5', 'products/0e6317cf-8f28-4af4-84ea-5a4135cfebf5/main.jpg', 0, 0, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO products (id, name, slug, description, category_id, price_paisa, compare_price_paisa, status, is_featured, created_at, updated_at)
  VALUES ('f3d5e286-fc3d-44ba-aafb-4889dac23552', 'Bridal Jewelry Set', 'bridal-jewelry-set', 'Bridal Jewelry Set - premium quality', '4e6d9a34-9454-4a7e-a5a3-fae9306fe383', 899900, NULL, 'published', 1, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO product_variants (id, product_id, sku, size, price_paisa, created_at, updated_at)
  VALUES ('97afdba0-f226-40d2-8b73-436b8e0979f3', 'f3d5e286-fc3d-44ba-aafb-4889dac23552', 'BRIDAL_JEWELRY_SET', 'M', 899900, '2026-06-04 00:00:00', '2026-06-04 00:00:00');
INSERT OR IGNORE INTO inventory_items (id, variant_id, quantity, reserved_quantity, is_available, updated_at)
  VALUES ('e8c29ed9-61f7-4e0e-b0b9-c438b97beee7', '97afdba0-f226-40d2-8b73-436b8e0979f3', 100, 0, 1, '2026-06-04 00:00:00');
INSERT OR IGNORE INTO product_images (id, product_id, r2_key, is_compressed, sort_order, created_at, updated_at)
  VALUES ('81860067-246b-4a55-adb7-48b09c56d097', 'f3d5e286-fc3d-44ba-aafb-4889dac23552', 'products/f3d5e286-fc3d-44ba-aafb-4889dac23552/main.jpg', 0, 0, '2026-06-04 00:00:00', '2026-06-04 00:00:00');

INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES ('seed_data', '2026-06-04 00:00:00');
