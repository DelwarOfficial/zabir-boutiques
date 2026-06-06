-- Zabir Boutiques v6.8A — Indexes
-- Canonical index names per Section 11

CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_token_active ON staff_sessions(token_hash) WHERE is_revoked = 0;

CREATE INDEX IF NOT EXISTS idx_low_stock_unacknowledged ON low_stock_alerts(is_acknowledged, created_at) WHERE is_acknowledged = 0;

CREATE INDEX IF NOT EXISTS idx_inventory_variant ON inventory_items(variant_id);

CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
CREATE INDEX IF NOT EXISTS idx_categories_sort ON categories(sort_order);

CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_variants_sku ON product_variants(sku);

CREATE INDEX IF NOT EXISTS idx_reservations_status_expires ON stock_reservations(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_reservations_order ON stock_reservations(order_id);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);

CREATE INDEX IF NOT EXISTS idx_payment_events_invoice ON payment_events(invoice_id);

CREATE INDEX IF NOT EXISTS idx_fraud_checks_order ON fraud_checks(order_id);
CREATE INDEX IF NOT EXISTS idx_fraud_checks_phone ON fraud_checks(phone);

CREATE INDEX IF NOT EXISTS idx_fraud_polls_status ON fraud_polls(status, next_poll_at);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);
