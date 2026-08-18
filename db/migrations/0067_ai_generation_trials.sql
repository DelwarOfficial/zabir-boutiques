-- N-29: evidence for the DeepSeek-vs-Workers-AI decision (Master Plan 24.1).
--
-- The provider choice for product descriptions is currently argued from model
-- size and task shape. This table replaces that argument with data: one row per
-- blind A/B comparison, recording both sides' objective metrics and which one
-- the staff member actually preferred without knowing which was which.
--
-- Deliberately stores no product FK: trials are run against draft names before
-- a product row exists.
CREATE TABLE IF NOT EXISTS ai_generation_trials (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  -- Which provider was shown in each blind slot, randomized per trial.
  slot_a_provider TEXT NOT NULL CHECK (slot_a_provider IN ('deepseek','workers_ai')),
  slot_b_provider TEXT NOT NULL CHECK (slot_b_provider IN ('deepseek','workers_ai')),
  metrics_json TEXT NOT NULL,
  -- NULL until the staff member picks; 'neither' is a real, meaningful answer.
  chosen_provider TEXT CHECK (chosen_provider IN ('deepseek','workers_ai','neither')),
  chosen_at TEXT,
  created_at TEXT NOT NULL
);
