-- Migration: server-side VAT storage [Master Plan V7 §11.1, §30.41]

ALTER TABLE orders ADD COLUMN vat_paisa INTEGER NOT NULL DEFAULT 0 CHECK (vat_paisa >= 0);
ALTER TABLE order_items ADD COLUMN vat_paisa INTEGER NOT NULL DEFAULT 0 CHECK (vat_paisa >= 0);
