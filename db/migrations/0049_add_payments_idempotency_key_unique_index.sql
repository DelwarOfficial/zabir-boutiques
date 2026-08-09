CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_order_idempotency_key
  ON payments(order_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
