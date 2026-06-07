-- Zabir Boutiques v6.8D — Partial Prepayment Migration
-- Documents the expanded payment_method contract for the orders table.
-- The original CHECK in 0001 only allows ('cod','uddoktapay').
-- D1 does not enforce CHECK constraints strictly, but the application layer
-- validates against the full set. If a clean rebuild is performed, update the
-- CHECK in 0001 to include all values.

-- Expanded payment_method contract (application-level enforced):
--   'cod'              — Cash on delivery (≤2 items)
--   'uddoktapay'       — Full online payment via UddoktaPay
--   'partial_prepay'   — 50% advance online, 50% COD (>2 items)
--   'in_store'         — Walk-in customer, no online payment

-- Expanded payment_status contract (partial_prepay uses 'partially_paid'):
--   'partially_paid'   — Advance portion paid via UddoktaPay, balance on delivery

-- Index for partial prepayment orders
CREATE INDEX IF NOT EXISTS idx_orders_partial_prepay
  ON orders(payment_status)
  WHERE payment_method = 'partial_prepay';
