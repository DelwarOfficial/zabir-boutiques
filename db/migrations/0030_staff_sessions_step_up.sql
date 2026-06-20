-- Add dedicated step-up timestamp so recent re-auth is separate from session activity.
-- The column is already present in the baseline schema; keep this migration as a marker.
INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0030_staff_sessions_step_up', '2026-06-20 00:00:00');
