-- Migration: courier_cod_remittance [Master Plan V8 F-03, T-24]
-- Tracks what a courier actually paid back to the shop for COD parcels
-- delivered in a period, against what orders.cod_collected_paisa says
-- they collected. Nothing else in the system records this today.

CREATE TABLE courier_cod_remittance (
  id TEXT PRIMARY KEY,
  courier TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  expected_paisa INTEGER NOT NULL CHECK (expected_paisa >= 0),
  received_paisa INTEGER NOT NULL CHECK (received_paisa >= 0),
  reconciled_by_staff_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  reconciled_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_courier_cod_remittance_courier_period ON courier_cod_remittance(courier, period_start, period_end);
