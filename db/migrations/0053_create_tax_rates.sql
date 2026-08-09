CREATE TABLE IF NOT EXISTS tax_rates (
  id TEXT PRIMARY KEY,
  applies_to TEXT NOT NULL CHECK (applies_to IN ('goods', 'delivery')),
  rate_percent INTEGER NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tax_rates_lookup ON tax_rates(applies_to, effective_from, effective_to);
