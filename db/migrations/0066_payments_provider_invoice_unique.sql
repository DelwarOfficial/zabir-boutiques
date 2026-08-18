-- N-28: the uniqueness guarantee behind provider-invoice binding (0065).
--
-- Binding is idempotent under concurrent callback/webhook delivery only if a
-- provider invoice id can never point at two local payments; this partial
-- index is what enforces that, while leaving unbound rows (NULL) unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_invoice ON payments(provider_invoice_id) WHERE provider_invoice_id IS NOT NULL;
