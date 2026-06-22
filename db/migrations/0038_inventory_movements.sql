-- Inventory Movements Enhancement [v6.8D]
-- Adds audit-grade tracking columns to stock_adjustments.
-- `prev_quantity` / `new_quantity` capture the inventory_items.quantity
-- before and after the adjustment. Old rows remain NULL.

ALTER TABLE stock_adjustments ADD COLUMN prev_quantity INTEGER;
ALTER TABLE stock_adjustments ADD COLUMN new_quantity INTEGER;
ALTER TABLE stock_adjustments ADD COLUMN notes TEXT;
