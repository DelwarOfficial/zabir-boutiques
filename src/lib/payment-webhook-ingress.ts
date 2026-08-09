/**
 * Payment webhook ingress [Master Plan §6.2, G6]
 *
 * HMAC verification + D1 event idempotency + queue handoff.
 * Processing (UddoktaPay verify + applyPaymentVerified) runs in the
 * payment-webhooks Queue consumer only.
 */
import { hmacSha256Hex, timingSafeEqualHex } from './security';

export type WebhookIngressBody = Record<string, unknown>;

/** Verify provider HMAC-SHA256 signature over the raw body (Web Crypto). */
export async function verifyPaymentWebhookSignature(
  rawBody: string,
  receivedSig: string,
  secret: string,
): Promise<boolean> {
  const normalized = receivedSig.replace(/^sha256=/i, '').trim().toLowerCase();
  if (!normalized) return false;
  const expected = await hmacSha256Hex(rawBody, secret);
  return timingSafeEqualHex(normalized, expected);
}

/** K-02: closed header list — generic X-Signature/Signature are attacker/proxy-settable. */
export function readWebhookSignature(request: Request): string {
  return (request.headers.get('X-UddoktaPay-Signature') || '').trim();
}

export function parseWebhookPayload(rawBody: string): WebhookIngressBody | null {
  if (!rawBody) return null;
  try {
    const parsed = JSON.parse(rawBody);
    return parsed && typeof parsed === 'object' ? parsed as WebhookIngressBody : null;
  } catch {
    return null;
  }
}

/** Stable provider event id for D1 idempotency (falls back to body hash). */
export async function resolveWebhookEventId(body: WebhookIngressBody, rawBody: string): Promise<string> {
  const candidates = [body.event_id, body.eventId, body.id, body.transaction_id, body.trx_id];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawBody));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}

export type WebhookReceiptResult = 'recorded' | 'duplicate' | 'payment_not_found';

/**
 * Persist webhook receipt in payment_events before queue processing.
 *
 * N-16/INV-2: dedup identity is (provider, provider_event_id) — the
 * provider's own event id — not an (invoice_id, event_type, status) tuple.
 * The old shape silently dropped a second GENUINE webhook for the same
 * invoice/type/status (e.g. a provider retry with a new event id), not just
 * replays. `id` (the row PK) is still set from the resolved event id so
 * existing PK-level replay protection (INSERT OR IGNORE) is unaffected.
 */
export async function recordWebhookReceipt(
  db: D1Database,
  opts: { eventId: string; invoiceId: string; rawBody: string; now: string },
): Promise<WebhookReceiptResult> {
  const payment = await db
    .prepare('SELECT id, provider FROM payments WHERE invoice_id = ?1')
    .bind(opts.invoiceId)
    .first<{ id: string; provider: string }>();
  if (!payment) return 'payment_not_found';

  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO payment_events (id, payment_id, invoice_id, event_type, status, provider, provider_event_id, raw_payload, created_at)
       VALUES (?1, ?2, ?3, 'webhook', 'received', ?4, ?5, ?6, ?7)`,
    )
    .bind(opts.eventId, payment.id, opts.invoiceId, payment.provider, opts.eventId, opts.rawBody.slice(0, 4000), opts.now)
    .run();

  return result.meta.changes === 1 ? 'recorded' : 'duplicate';
}