-- Zabir Boutiques v7.0 — POS Invoices
-- New tables for in-store shop sales managed by staff from the
-- Staff Dashboard. Distinct from the `orders` table because POS
-- sales have different invariants (cash drawer, receipt number,
-- NBR tax fields, no fraud check, no UddoktaPay webhook, no
-- shipment).
--
-- Concurrency model:
--   1. Receipt number is unique per invoice (B-tree on receipt_no).
--   2. Stock deducts happen on invoice creation (no 10-min
--      reservation — POS is pay-then-take or pay-on-counter).
--   3. Each invoice has an idempotency_key column so a cashier
--      who double-clicks the "Create" button cannot create two
--      invoices for the same sale.
--   4. Status machine: draft → issued → paid → (voided | refunded).
--      Only `issued` and `paid` invoices count against stock.
--
-- Bangladesh NBR SRO 198/Law/2015 fields:
--   bin  — Business Identification Number (15 digits, NBR-issued)
--   tin  — Taxpayer Identification Number (12 digits, NBR-issued)
-- These are operator-supplied via wrangler.toml vars; the invoice
-- is printable without them but the receipt is missing the legal
-- footer.

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  receipt_no TEXT NOT NULL UNIQUE,
  idempotency_key TEXT UNIQUE,
  cashier_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  customer_name TEXT,
  customer_phone TEXT,
  -- Cash, card, mobile-wallet, mixed. For a single invoice the
  -- amount is split across payment_methods rows.
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','issued','paid','voided','refunded')),
  subtotal_paisa INTEGER NOT NULL CHECK (subtotal_paisa >= 0),
  discount_paisa INTEGER NOT NULL DEFAULT 0 CHECK (discount_paisa >= 0),
  vat_paisa INTEGER NOT NULL DEFAULT 0 CHECK (vat_paisa >= 0),
  total_paisa INTEGER NOT NULL CHECK (total_paisa >= 0),
  amount_paid_paisa INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid_paisa >= 0),
  change_due_paisa INTEGER NOT NULL DEFAULT 0 CHECK (change_due_paisa >= 0),
  notes TEXT,
  voided_reason TEXT,
  voided_by TEXT REFERENCES staff_users(id) ON DELETE RESTRICT,
  voided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- The invoice is "paid" when stock has been deducted. Issuing
  -- an invoice reserves stock and locks the receipt number, but
  -- the receipt is only "complete" once the cash drawer closes
  -- (status='paid').
  paid_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_invoices_cashier_created
  ON invoices(cashier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status_created
  ON invoices(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_receipt_no
  ON invoices(receipt_no);

CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  variant_label TEXT NOT NULL,
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_paisa INTEGER NOT NULL CHECK (unit_price_paisa >= 0),
  total_price_paisa INTEGER NOT NULL CHECK (total_price_paisa >= 0),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice
  ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_variant
  ON invoice_items(variant_id);

-- A sale may be split across multiple payment methods (e.g. 500 BDT
-- cash + 300 BDT bKash). For a single-method sale, there is one
-- row. For refunds, a negative row is written.
CREATE TABLE IF NOT EXISTS invoice_payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  method TEXT NOT NULL
    CHECK (method IN ('cash','card','bkash','nagad','rocket','bank_transfer','other')),
  amount_paisa INTEGER NOT NULL,
  reference TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice
  ON invoice_payments(invoice_id);

-- Append-only audit log of every state transition. Distinct from
-- `audit_log` (which is the platform-wide tamper-evident ledger)
-- because POS audit has higher write volume and doesn't need
-- the chain-hash guarantee.
CREATE TABLE IF NOT EXISTS invoice_audit (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  actor_staff_id TEXT REFERENCES staff_users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invoice_audit_invoice
  ON invoice_audit(invoice_id, created_at DESC);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0016_invoices', '2026-06-16 00:00:00');
