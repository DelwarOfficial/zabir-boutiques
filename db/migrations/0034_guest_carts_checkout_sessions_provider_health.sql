-- Migration: guest_carts, checkout_sessions, provider_health tables [DO Refactor]
-- Replaces CartDO, DirectCheckoutSessionDO, and ProviderHealthDO with D1 tables.
-- Enables free-tier support by removing non-critical Durable Objects.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. guest_carts: Replaces CartDO for guest cart sessions
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS guest_carts (
  sessionId TEXT PRIMARY KEY,
  items JSON NOT NULL,
  lastUpdatedAt TEXT NOT NULL,
  version INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_guest_carts_lastUpdatedAt
  ON guest_carts(lastUpdatedAt);

-- ──────────────────────────────────────────────────────────────────────────
-- 2. checkout_sessions: Replaces DirectCheckoutSessionDO for Buy Now flows
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS checkout_sessions (
  sessionId TEXT PRIMARY KEY,
  productId TEXT NOT NULL,
  variantId TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  selectedOptions JSON,
  sourcePage TEXT,
  utmParams JSON,
  createdAt TEXT NOT NULL,
  deletedAt TEXT
);

CREATE INDEX IF NOT EXISTS idx_checkout_sessions_createdAt
  ON checkout_sessions(createdAt);

CREATE INDEX IF NOT EXISTS idx_checkout_sessions_deletedAt
  ON checkout_sessions(deletedAt);

-- ──────────────────────────────────────────────────────────────────────────
-- 3. provider_health: Replaces ProviderHealthDO for circuit breaker state
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS provider_health (
  provider TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK(state IN ('closed', 'open', 'half_open')),
  lastFailureAt TEXT,
  failureCount INTEGER DEFAULT 0,
  resetAt TEXT,
  updatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_provider_health_state
  ON provider_health(state);

CREATE INDEX IF NOT EXISTS idx_provider_health_resetAt
  ON provider_health(resetAt);
