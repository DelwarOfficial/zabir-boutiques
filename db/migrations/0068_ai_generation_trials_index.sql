-- N-29: supports the "which provider wins" rollup over completed trials.
CREATE INDEX IF NOT EXISTS idx_ai_trials_chosen ON ai_generation_trials(chosen_provider, created_at DESC);
