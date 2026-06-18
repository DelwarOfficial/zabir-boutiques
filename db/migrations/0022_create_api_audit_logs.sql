-- Migration: create external API audit log [Master Plan V7 §2.5, §6.1, §11.2]

CREATE TABLE IF NOT EXISTS api_audit_logs (
  audit_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  request_id TEXT NOT NULL,
  order_id TEXT,
  invoice_id TEXT,
  duration_ms INTEGER,
  status TEXT NOT NULL CHECK(status IN ('success','error','timeout','circuit_open')),
  error_code TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  circuit_state TEXT CHECK(circuit_state IS NULL OR circuit_state IN ('closed','open','half_open')),
  redacted_request_summary TEXT,
  redacted_response_summary TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_audit_provider_created ON api_audit_logs(provider, created_at);
CREATE INDEX IF NOT EXISTS idx_api_audit_circuit_state ON api_audit_logs(provider, circuit_state, created_at);
CREATE INDEX IF NOT EXISTS idx_api_audit_order ON api_audit_logs(order_id) WHERE order_id IS NOT NULL;
