-- Site Settings Seed Data [v6.8D]
-- Adds common store configuration defaults. All INSERT OR IGNORE for idempotency.
-- Update values via the staff UI or direct SQL as needed.

INSERT OR IGNORE INTO site_settings (key, value, type, label, description, group_name, sort_order, created_at, updated_at)
VALUES ('store.name', 'Zabir Boutiques', 'text', 'Store Name', 'Display name shown across the site', 'Store', 1, '2026-06-22 00:00:00', '2026-06-22 00:00:00');

INSERT OR IGNORE INTO site_settings (key, value, type, label, description, group_name, sort_order, created_at, updated_at)
VALUES ('store.tagline', 'Premium Pakistani & Indian Fashion', 'text', 'Store Tagline', 'Short tagline for the site header', 'Store', 2, '2026-06-22 00:00:00', '2026-06-22 00:00:00');

INSERT OR IGNORE INTO site_settings (key, value, type, label, description, group_name, sort_order, created_at, updated_at)
VALUES ('store.address', 'House 12, Road 5, Gulshan 1, Dhaka 1212, Bangladesh', 'textarea', 'Store Address', 'Physical store location', 'Store', 3, '2026-06-22 00:00:00', '2026-06-22 00:00:00');

INSERT OR IGNORE INTO site_settings (key, value, type, label, description, group_name, sort_order, created_at, updated_at)
VALUES ('store.phone', '+8801712345678', 'phone', 'Store Phone', 'Customer service phone number', 'Store', 4, '2026-06-22 00:00:00', '2026-06-22 00:00:00');

INSERT OR IGNORE INTO site_settings (key, value, type, label, description, group_name, sort_order, created_at, updated_at)
VALUES ('store.email', 'info@zabirboutiques.com', 'email', 'Store Email', 'Customer service email address', 'Store', 5, '2026-06-22 00:00:00', '2026-06-22 00:00:00');

INSERT OR IGNORE INTO site_settings (key, value, type, label, description, group_name, sort_order, created_at, updated_at)
VALUES ('store.logo', '', 'image', 'Store Logo', 'R2 key or URL for the store logo', 'Store', 6, '2026-06-22 00:00:00', '2026-06-22 00:00:00');

INSERT OR IGNORE INTO site_settings (key, value, type, label, description, group_name, sort_order, created_at, updated_at)
VALUES ('store.social_facebook', 'https://facebook.com/zabirboutiques', 'url', 'Facebook URL', 'Facebook page link', 'Store', 7, '2026-06-22 00:00:00', '2026-06-22 00:00:00');

INSERT OR IGNORE INTO site_settings (key, value, type, label, description, group_name, sort_order, created_at, updated_at)
VALUES ('store.social_instagram', 'https://instagram.com/zabirboutiques', 'url', 'Instagram URL', 'Instagram page link', 'Store', 8, '2026-06-22 00:00:00', '2026-06-22 00:00:00');

INSERT OR IGNORE INTO site_settings (key, value, type, label, description, group_name, sort_order, created_at, updated_at)
VALUES ('store.social_whatsapp', 'https://wa.me/8801712345678', 'url', 'WhatsApp URL', 'WhatsApp contact link', 'Store', 9, '2026-06-22 00:00:00', '2026-06-22 00:00:00');

INSERT OR IGNORE INTO site_settings (key, value, type, label, description, group_name, sort_order, created_at, updated_at)
VALUES ('delivery_inside_dhaka_paisa', '70', 'number', 'Delivery Inside Dhaka (paisa)', 'Flat delivery fee for Dhaka addresses in paisa', 'Shipping', 1, '2026-06-22 00:00:00', '2026-06-22 00:00:00');

INSERT OR IGNORE INTO site_settings (key, value, type, label, description, group_name, sort_order, created_at, updated_at)
VALUES ('delivery_outside_dhaka_paisa', '150', 'number', 'Delivery Outside Dhaka (paisa)', 'Flat delivery fee for addresses outside Dhaka in paisa', 'Shipping', 2, '2026-06-22 00:00:00', '2026-06-22 00:00:00');
