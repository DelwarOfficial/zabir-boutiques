-- Rollback for 0010_coupon_claim_tokens.sql
-- Drops the checkout_idempotency_coupon_claims table and its index.
-- Coupon release semantics revert to the pre-0010 behavior (no claim
-- ledger, no idempotency on double release).
DROP INDEX IF EXISTS idx_coupon_claims_key;
DROP TABLE IF EXISTS checkout_idempotency_coupon_claims;

DELETE FROM schema_migrations WHERE version = '0010_coupon_claim_tokens';
