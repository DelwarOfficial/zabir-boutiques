-- Migration: goods_receipts [Master Plan V8 RT-003, T-26]
-- adjustment_id is the doAdjustStock idempotency key that applied this
-- receipt's stock increase — ties the ledger row to the actual mutation.
CREATE TABLE goods_receipts (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost_paisa INTEGER NOT NULL CHECK (unit_cost_paisa >= 0),
  adjustment_id TEXT NOT NULL,
  received_by_staff_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  received_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_goods_receipts_adjustment ON goods_receipts(adjustment_id);
CREATE INDEX idx_goods_receipts_po ON goods_receipts(purchase_order_id);
