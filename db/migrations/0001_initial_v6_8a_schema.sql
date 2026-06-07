-- Zabir Boutiques v6.8D — Canonical D1 Schema (complete with staff ops v2 + partial prepay columns/CHECKS)
-- All IDs generated in runtime code using crypto.randomUUID()
-- All timestamps use TEXT in format YYYY-MM-DD HH:MM:SS (UTC)
-- All money values are INTEGER paisa
-- Never use SQLite datetime("now") in application code

PRAGMA foreign_keys = ON;

-- 1. schema_migrations
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- 2. staff_users
CREATE TABLE IF NOT EXISTS staff_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'support'
    CHECK (role IN ('super_admin','owner','manager','salesman','packing','support')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

-- 3. staff_sessions
CREATE TABLE IF NOT EXISTS staff_sessions (
  id TEXT PRIMARY KEY,
  staff_user_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  is_revoked INTEGER NOT NULL DEFAULT 0 CHECK (is_revoked IN (0,1)),
  expires_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 4. categories
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  meta_title TEXT,
  meta_description TEXT,
  image_url TEXT,
  parent_id TEXT REFERENCES categories(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 5. products
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  category_id TEXT REFERENCES categories(id),
  price_paisa INTEGER NOT NULL CHECK (price_paisa >= 0),
  compare_price_paisa INTEGER CHECK (compare_price_paisa IS NULL OR compare_price_paisa >= 0),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),
  is_featured INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0,1)),
  meta_title TEXT,
  meta_description TEXT,
  created_by TEXT REFERENCES staff_users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 6. product_variants (soft-delete)
CREATE TABLE IF NOT EXISTS product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  sku TEXT UNIQUE NOT NULL,
  size TEXT,
  color TEXT,
  price_paisa INTEGER CHECK (price_paisa IS NULL OR price_paisa >= 0),
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 7. product_images
CREATE TABLE IF NOT EXISTS product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  r2_key TEXT NOT NULL,
  alt_text TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_compressed INTEGER NOT NULL DEFAULT 0 CHECK (is_compressed IN (0,1)),
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 8. inventory_items
CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL UNIQUE REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0,1)),
  updated_at TEXT NOT NULL
);

-- 9. coupons (soft-delete)
CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('fixed','percentage')),
  discount_amount_paisa INTEGER,
  discount_percent INTEGER CHECK (discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent <= 100)),
  max_discount_paisa INTEGER,
  min_order_paisa INTEGER NOT NULL DEFAULT 0,
  usage_limit INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  starts_at TEXT,
  expires_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_by TEXT REFERENCES staff_users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 10. fraud_checks
CREATE TABLE IF NOT EXISTS fraud_checks (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  phone TEXT NOT NULL,
  risk_score INTEGER,
  decision TEXT NOT NULL CHECK (decision IN ('approved','review','blocked')),
  raw_response TEXT,
  created_at TEXT NOT NULL
);

-- 11. orders
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  note TEXT,
  shipping_zone TEXT,
  subtotal_paisa INTEGER NOT NULL CHECK (subtotal_paisa >= 0),
  delivery_paisa INTEGER NOT NULL DEFAULT 0 CHECK (delivery_paisa >= 0),
  discount_paisa INTEGER NOT NULL DEFAULT 0 CHECK (discount_paisa >= 0),
  total_paisa INTEGER NOT NULL CHECK (total_paisa >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cod','uddoktapay','partial_prepay','in_store')),
  payment_status TEXT NOT NULL DEFAULT 'created'
    CHECK (payment_status IN ('created','pending','processing','paid','partially_paid','failed','cancelled','expired','refunded')),
  fraud_decision TEXT NOT NULL DEFAULT 'review'
    CHECK (fraud_decision IN ('approved','review','blocked')),
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','pending_payment','payment_verified','paid_over_allocated','staff_confirmed','packing','shipped','delivered','cancelled','refunded')),
  created_by TEXT REFERENCES staff_users(id),
  order_channel TEXT DEFAULT 'web'
    CHECK (order_channel IN ('web','in_store','phone','messenger','whatsapp')),
  advance_paisa INTEGER NOT NULL DEFAULT 0 CHECK (advance_paisa >= 0),
  balance_paisa INTEGER NOT NULL DEFAULT 0 CHECK (balance_paisa >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 12. order_items (snapshot at checkout time)
CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  variant_label TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_paisa INTEGER NOT NULL CHECK (unit_price_paisa >= 0),
  total_price_paisa INTEGER NOT NULL CHECK (total_price_paisa >= 0),
  created_at TEXT NOT NULL
);

-- 13. stock_reservations
CREATE TABLE IF NOT EXISTS stock_reservations (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','confirmed','released','expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 14. order_status_history
CREATE TABLE IF NOT EXISTS order_status_history (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by TEXT REFERENCES staff_users(id),
  note TEXT,
  created_at TEXT NOT NULL
);

-- 15. payments
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  invoice_id TEXT UNIQUE,
  provider TEXT NOT NULL DEFAULT 'uddoktapay',
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa >= 0),
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','pending','processing','paid','failed','cancelled','expired','refunded')),
  checkout_url TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 16. payment_events (webhook idempotency)
CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  invoice_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  raw_payload TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(invoice_id, event_type, status)
);

-- 17. low_stock_alerts
CREATE TABLE IF NOT EXISTS low_stock_alerts (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  message TEXT NOT NULL,
  is_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (is_acknowledged IN (0,1)),
  created_at TEXT NOT NULL
);

-- 18. site_settings
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'text'
    CHECK (type IN ('text','textarea','number','boolean','image','phone','url','email')),
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL DEFAULT 'general',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 19. audit_log
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_staff_id TEXT REFERENCES staff_users(id),
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  metadata_json TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

-- 20. checkout_idempotency
CREATE TABLE IF NOT EXISTS checkout_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  order_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('processing','complete','failed')),
  response_body TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- 21. fraud_polls
CREATE TABLE IF NOT EXISTS fraud_polls (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  process_id TEXT NOT NULL,
  poll_count INTEGER NOT NULL DEFAULT 0 CHECK (poll_count >= 0),
  next_poll_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','timeout','failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Record this migration
INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES ('0001_initial_v6_8a', '2026-06-04 00:00:00');
