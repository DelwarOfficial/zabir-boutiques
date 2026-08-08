-- Migration: seed COD ceiling/velocity + return window defaults [Master Plan V8 §11.1 step 11, RV8-006, S-04, F-10]
-- site_settings already exists (0001_initial_v6_8a_schema.sql, seeded by
-- 0037_site_settings_seed.sql). These are new rows, not a new table.

INSERT OR IGNORE INTO site_settings (key, value, type, label, description, group_name, sort_order, created_at, updated_at)
VALUES ('commerce.max_cod_value_paisa', '500000', 'number', 'Max COD Order Value (paisa)', 'COD is refused above this order total; requires online payment instead. Default BDT 5,000.', 'Commerce', 100, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO site_settings (key, value, type, label, description, group_name, sort_order, created_at, updated_at)
VALUES ('commerce.cod_orders_per_phone_24h', '2', 'number', 'COD Orders / Phone / 24h', 'Max COD orders from one phone number in a rolling 24 hours before online payment is required.', 'Commerce', 101, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO site_settings (key, value, type, label, description, group_name, sort_order, created_at, updated_at)
VALUES ('commerce.cod_orders_per_address_24h', '3', 'number', 'COD Orders / Address / 24h', 'Max COD orders to one delivery address in a rolling 24 hours before online payment is required.', 'Commerce', 102, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO site_settings (key, value, type, label, description, group_name, sort_order, created_at, updated_at)
VALUES ('commerce.return_window_days', '7', 'number', 'Return Window (days)', 'Days after delivery a return may be created without a staff override.', 'Commerce', 103, datetime('now'), datetime('now'));
