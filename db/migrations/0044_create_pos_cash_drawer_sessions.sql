-- Migration: pos_cash_drawer_sessions [Master Plan V8 F-09, T-25]
-- End-of-day cash reconciliation. Without this, a cash payment method has
-- no session concept and no expected-vs-counted check — the standard
-- control against cashier error or theft for a physical counter.

CREATE TABLE pos_cash_drawer_sessions (
  id TEXT PRIMARY KEY,
  opened_by_staff_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  opened_at TEXT NOT NULL,
  opening_float_paisa INTEGER NOT NULL CHECK (opening_float_paisa >= 0),
  closed_by_staff_id TEXT REFERENCES staff_users(id) ON DELETE RESTRICT,
  closed_at TEXT,
  expected_cash_paisa INTEGER,
  counted_cash_paisa INTEGER,
  variance_paisa INTEGER,
  notes TEXT
);

CREATE INDEX idx_pos_cash_drawer_sessions_open ON pos_cash_drawer_sessions(opened_by_staff_id) WHERE closed_at IS NULL;
