-- Rollback for 0016_invoices.sql
-- WARNING: this drops the entire POS sales ledger. Refuse to run on
-- a populated environment. Refuse to run if any invoice has status
-- 'paid' — those stock decrements are not reversible by this script.
DROP INDEX IF EXISTS idx_invoice_audit_invoice;
DROP TABLE IF EXISTS invoice_audit;
DROP INDEX IF EXISTS idx_invoice_payments_invoice;
DROP TABLE IF EXISTS invoice_payments;
DROP INDEX IF EXISTS idx_invoice_items_variant;
DROP INDEX IF EXISTS idx_invoice_items_invoice;
DROP TABLE IF EXISTS invoice_items;
DROP INDEX IF EXISTS idx_invoices_receipt_no;
DROP INDEX IF EXISTS idx_invoices_status_created;
DROP INDEX IF EXISTS idx_invoices_cashier_created;
DROP TABLE IF EXISTS invoices;

DELETE FROM schema_migrations WHERE version = '0016_invoices';
