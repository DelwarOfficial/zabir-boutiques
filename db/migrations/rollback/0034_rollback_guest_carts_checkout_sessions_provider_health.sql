-- Rollback for 0034_guest_carts_checkout_sessions_provider_health.sql
-- Reverses: guest_carts, checkout_sessions, provider_health tables + indexes.
-- Indexes are dropped automatically with their tables in SQLite.

DROP TABLE IF EXISTS provider_health;
DROP TABLE IF EXISTS checkout_sessions;
DROP TABLE IF EXISTS guest_carts;
