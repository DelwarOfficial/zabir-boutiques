import { nowSql } from './dates';
import { safeLog } from './pii-scrubber';

export interface ApiAuditEntry {
  provider: string;
  operation: string;
  requestId: string;
  orderId?: string | null;
  invoiceId?: string | null;
  durationMs?: number | null;
  status: 'success' | 'error' | 'timeout' | 'circuit_open';
  errorCode?: string | null;
  retryCount?: number;
  circuitState?: 'closed' | 'open' | 'half_open' | null;
  redactedRequestSummary?: string | null;
  redactedResponseSummary?: string | null;
}

export async function writeApiAuditLog(db: D1Database | undefined, entry: ApiAuditEntry): Promise<void> {
  if (!db) return;
  try {
    await db.prepare(
      `INSERT INTO api_audit_logs (
        audit_id, provider, operation, request_id, order_id, invoice_id,
        duration_ms, status, error_code, retry_count, circuit_state,
        redacted_request_summary, redacted_response_summary, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    ).bind(
      crypto.randomUUID(),
      entry.provider,
      entry.operation,
      entry.requestId,
      entry.orderId ?? null,
      entry.invoiceId ?? null,
      entry.durationMs ?? null,
      entry.status,
      entry.errorCode ?? null,
      entry.retryCount ?? 0,
      entry.circuitState ?? null,
      entry.redactedRequestSummary ?? null,
      entry.redactedResponseSummary ?? null,
      nowSql(),
    ).run();
  } catch (err) {
    safeLog.error('[api-audit] write failed', { error: err instanceof Error ? err.message : String(err), provider: entry.provider, operation: entry.operation });
  }
}
