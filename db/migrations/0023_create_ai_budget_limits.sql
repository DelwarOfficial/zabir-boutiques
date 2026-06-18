-- Migration: create AI budget limit config [Master Plan V7 §6.1, §24.2]

CREATE TABLE IF NOT EXISTS ai_budget_limits (
  provider TEXT PRIMARY KEY CHECK(provider IN ('workers_ai','deepseek','imagify')),
  daily_limit_usd_cents INTEGER NOT NULL CHECK(daily_limit_usd_cents >= 0),
  monthly_limit_usd_cents INTEGER NOT NULL CHECK(monthly_limit_usd_cents >= 0),
  daily_call_limit INTEGER NOT NULL CHECK(daily_call_limit >= 0),
  monthly_call_limit INTEGER NOT NULL CHECK(monthly_call_limit >= 0),
  soft_alert_percent INTEGER NOT NULL DEFAULT 80 CHECK(soft_alert_percent BETWEEN 0 AND 100),
  hard_block_percent INTEGER NOT NULL DEFAULT 100 CHECK(hard_block_percent BETWEEN 0 AND 100),
  owner_override INTEGER NOT NULL DEFAULT 0 CHECK(owner_override IN (0,1)),
  updated_at TEXT NOT NULL,
  updated_by_staff_id TEXT REFERENCES staff_users(id)
);

INSERT OR IGNORE INTO ai_budget_limits (
  provider, daily_limit_usd_cents, monthly_limit_usd_cents, daily_call_limit,
  monthly_call_limit, soft_alert_percent, hard_block_percent, owner_override,
  updated_at, updated_by_staff_id
) VALUES
  ('workers_ai', 100, 2000, 200, 5000, 80, 100, 0, datetime('now'), NULL),
  ('deepseek', 500, 10000, 50, 1000, 80, 100, 0, datetime('now'), NULL),
  ('imagify', 100, 2000, 100, 3000, 80, 100, 0, datetime('now'), NULL);
