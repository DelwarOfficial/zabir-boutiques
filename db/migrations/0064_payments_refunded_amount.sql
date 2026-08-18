-- N-28: canonical refunded total, so partial-refund caps are enforced from D1
-- rather than trusting client input or recomputing from audit rows.
ALTER TABLE payments ADD COLUMN refunded_amount_paisa INTEGER NOT NULL DEFAULT 0;
