import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Mock the dynamically-imported modules so we can force failure/retry paths.
vi.mock('../src/lib/fraud', () => ({
  checkFraudBD: vi.fn(),
  decideFraudRisk: vi.fn(),
}));
vi.mock('../src/lib/maintenance/backup', () => ({
  backupD1ToR2: vi.fn(),
}));

import { handleFraudAuditBatch, handleD1BackupBatch } from '../src/queues/consumers';
import { checkFraudBD, decideFraudRisk } from '../src/lib/fraud';
import { backupD1ToR2 } from '../src/lib/maintenance/backup';

function mockDb(order: { id: string; status: string } | null) {
  const stmt = {
    bind() {
      return stmt;
    },
    async first<T>(): Promise<T | null> {
      return order as T | null;
    },
    async all<T>(): Promise<{ results: T[] }> {
      return { results: [] };
    },
    async run() {
      return { meta: { changes: 1 } };
    },
  };
  return {
    prepare() {
      return stmt;
    },
    async batch() {
      return [{ meta: { changes: 1 } }];
    },
  } as unknown as D1Database;
}

function msg(body: unknown) {
  return {
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

describe('QUEUE-1: fraud-audit and d1-backup have dead-letter queues configured', () => {
  const text = readFileSync(resolve('./wrangler.jsonc'), 'utf8');
  function consumerLine(queue: string): string {
    const m = text.match(new RegExp(`"queue":\\s*"${queue}"[^\\n]*"max_retries"[^\\n]*`));
    if (!m) throw new Error(`consumer for queue "${queue}" not found`);
    return m[0];
  }
  function deadLetterOf(queue: string): string | undefined {
    const line = consumerLine(queue);
    const m = line.match(/"dead_letter_queue":\s*"([^"]+)"/);
    return m?.[1];
  }

  it('wires a dead-letter queue for fraud-audit (all envs) and keeps payment-webhooks', () => {
    expect(deadLetterOf('fraud-audit')).toBe('fraud-audit-dlq');
    expect(deadLetterOf('fraud-audit-staging')).toBe('fraud-audit-dlq-staging');
    expect(deadLetterOf('fraud-audit-dev')).toBe('fraud-audit-dlq-dev');
    expect(deadLetterOf('payment-webhooks')).toBe('payment-webhooks-dlq');
  });

  it('wires a dead-letter queue for d1-backup (all envs)', () => {
    expect(deadLetterOf('d1-backup')).toBe('d1-backup-dlq');
    expect(deadLetterOf('d1-backup-staging')).toBe('d1-backup-dlq-staging');
    expect(deadLetterOf('d1-backup-dev')).toBe('d1-backup-dlq-dev');
  });

  it('does not add DLQs to queues the audit did not flag', () => {
    expect(deadLetterOf('order-emails')).toBeUndefined();
    expect(deadLetterOf('image-processing')).toBeUndefined();
    expect(deadLetterOf('cart-activity')).toBeUndefined();
  });
});

describe('QUEUE-1: consumers retry on failure so messages reach the DLQ, never silently dropped', () => {
  it('fraud-audit retries (not acks) when the fraud provider errors', async () => {
    (checkFraudBD as unknown as vi.Mock).mockResolvedValue({ score: null, rawResponse: '{"error":true}' });
    (decideFraudRisk as unknown as vi.Mock).mockReturnValue('review');

    const m = msg({ orderId: 'o1', phone: '01700000000' });
    await handleFraudAuditBatch(
      { messages: [m] } as unknown as MessageBatch<any>,
      { DB: mockDb({ id: 'o1', status: 'pending_review' }), FRAUDBD_API_KEY: 'k' } as any,
    );

    expect(m.retry).toHaveBeenCalledTimes(1);
    expect(m.ack).not.toHaveBeenCalled();
  });

  it('fraud-audit acks (not retries) a poison message whose order no longer exists', async () => {
    (checkFraudBD as unknown as vi.Mock).mockResolvedValue({ score: 50, rawResponse: '{}' });
    (decideFraudRisk as unknown as vi.Mock).mockReturnValue('review');

    const m = msg({ orderId: 'ghost', phone: '01700000000' });
    await handleFraudAuditBatch(
      { messages: [m] } as unknown as MessageBatch<any>,
      { DB: mockDb(null), FRAUDBD_API_KEY: 'k' } as any,
    );

    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(m.retry).not.toHaveBeenCalled();
  });

  it('d1-backup retries (not acks) when the backup to R2 fails', async () => {
    (backupD1ToR2 as unknown as vi.Mock).mockRejectedValue(new Error('r2 unavailable'));

    const m = msg({ triggeredAt: '2026-01-01 00:00:00' });
    await handleD1BackupBatch(
      { messages: [m] } as unknown as MessageBatch<any>,
      { DB: mockDb(null) } as any,
    );

    expect(m.retry).toHaveBeenCalledTimes(1);
    expect(m.ack).not.toHaveBeenCalled();
  });
});
