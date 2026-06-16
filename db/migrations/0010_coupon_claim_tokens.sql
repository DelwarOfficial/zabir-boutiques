-- Zabir Boutiques v6.8D — Coupon Claim Tokens
-- Adds a per-claim ledger so coupon releases are idempotent. Each
-- successful `applyCouponAtomic` returns a UUID claim token. The token
-- is recorded against the checkout's idempotency key; `releaseCouponUsageAtomic`
-- deletes the row and decrements `used_count` only when the row existed,
-- preventing double-release on failure-path retries.

CREATE TABLE IF NOT EXISTS checkout_idempotency_coupon_claims (
  idempotency_key TEXT NOT NULL,
  claim_token TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (idempotency_key, claim_token)
);

CREATE INDEX IF NOT EXISTS idx_coupon_claims_key
  ON checkout_idempotency_coupon_claims(idempotency_key);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0010_coupon_claim_tokens', '2026-06-09 00:00:00');
