import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  verifyPaymentWebhookSignature,
  parseWebhookPayload,
  resolveWebhookEventId,
  recordWebhookReceipt,
} from '../src/lib/payment-webhook-ingress';
import { hmacSha256Hex } from '../src/lib/security';

const SECRET = 'webhook-test-secret';

const mockDb = (overrides: { paymentId?: string | null; insertChanges?: number } = {}) => ({
  prepare: vi.fn().mockReturnThis(),
  bind: vi.fn().mockReturnThis(),
  first: vi.fn().mockResolvedValue(
    overrides.paymentId === null ? null : { id: overrides.paymentId ?? 'pay-1' },
  ),
  run: vi.fn().mockResolvedValue({ meta: { changes: overrides.insertChanges ?? 1 } }),
} as unknown as D1Database);

describe('payment webhook ingress', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('verifyPaymentWebhookSignature accepts valid HMAC-SHA256', async () => {
    const body = '{"invoice_id":"inv-1"}';
    const sig = await hmacSha256Hex(body, SECRET);
    expect(await verifyPaymentWebhookSignature(body, sig, SECRET)).toBe(true);
    expect(await verifyPaymentWebhookSignature(body, `sha256=${sig}`, SECRET)).toBe(true);
  });

  it('verifyPaymentWebhookSignature rejects invalid signature', async () => {
    const body = '{"invoice_id":"inv-1"}';
    expect(await verifyPaymentWebhookSignature(body, 'deadbeef', SECRET)).toBe(false);
    expect(await verifyPaymentWebhookSignature(body, '', SECRET)).toBe(false);
  });

  it('parseWebhookPayload returns null for invalid JSON', () => {
    expect(parseWebhookPayload('not-json')).toBeNull();
    expect(parseWebhookPayload('')).toBeNull();
  });

  it('resolveWebhookEventId prefers provider event_id', async () => {
    const id = await resolveWebhookEventId({ event_id: 'evt-42', invoice_id: 'inv-1' }, '{}');
    expect(id).toBe('evt-42');
  });

  it('resolveWebhookEventId falls back to body hash', async () => {
    const raw = '{"invoice_id":"inv-9"}';
    const id = await resolveWebhookEventId({ invoice_id: 'inv-9' }, raw);
    expect(id.startsWith('sha256:')).toBe(true);
  });

  it('recordWebhookReceipt returns payment_not_found when invoice unknown', async () => {
    const db = mockDb({ paymentId: null });
    const result = await recordWebhookReceipt(db, {
      eventId: 'evt-1',
      invoiceId: 'missing',
      rawBody: '{}',
      now: '2026-01-01 00:00:00',
    });
    expect(result).toBe('payment_not_found');
  });

  it('recordWebhookReceipt returns recorded on first insert', async () => {
    const db = mockDb({ insertChanges: 1 });
    const result = await recordWebhookReceipt(db, {
      eventId: 'evt-1',
      invoiceId: 'inv-1',
      rawBody: '{"invoice_id":"inv-1"}',
      now: '2026-01-01 00:00:00',
    });
    expect(result).toBe('recorded');
  });

  it('recordWebhookReceipt returns duplicate on replay', async () => {
    const db = mockDb({ insertChanges: 0 });
    const result = await recordWebhookReceipt(db, {
      eventId: 'evt-1',
      invoiceId: 'inv-1',
      rawBody: '{"invoice_id":"inv-1"}',
      now: '2026-01-01 00:00:00',
    });
    expect(result).toBe('duplicate');
  });
});