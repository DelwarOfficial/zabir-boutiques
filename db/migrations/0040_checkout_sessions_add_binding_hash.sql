-- Migration: checkout_sessions binding hash [Master Plan V8 §10.6, RT-005, S-02]
-- The D1-fallback path for DirectCheckoutSessionDO (used when
-- DIRECT_CHECKOUT_DO is not bound, e.g. free-tier deploy) needs the same
-- secret-cookie binding contract as the DO path. Without this column the
-- fallback path has no way to bind a session to anything but the sid
-- itself, which an attacker who observes the URL can replay.

ALTER TABLE checkout_sessions ADD COLUMN bindingHash TEXT;
