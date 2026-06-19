-- Add dedicated step-up timestamp so recent re-auth is separate from session activity.
ALTER TABLE staff_sessions ADD COLUMN step_up_at TEXT;
