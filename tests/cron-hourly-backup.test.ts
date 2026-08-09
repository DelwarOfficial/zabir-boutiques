import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('INV-4: D1 backup to R2 runs hourly, not every 6 hours', () => {
  it('cron-dispatch.ts no longer gates the backup enqueue on utcHour % 6', () => {
    const src = readFileSync(resolve('./src/lib/cron-dispatch.ts'), 'utf8');
    expect(src).not.toContain('if (utcHour % 6 === 0)');
  });

  it('enqueueD1Backup is still called unconditionally inside the hourly block', () => {
    const src = readFileSync(resolve('./src/lib/cron-dispatch.ts'), 'utf8');
    const hourlyBlock = src.slice(src.indexOf('"0 * * * *"'), src.indexOf('"0 0 1 * *"') === -1 ? undefined : src.indexOf('"0 0 1 * *"'));
    expect(hourlyBlock).toContain('enqueueD1Backup');
  });
});

describe('INV-4: enqueueD1Backup actually fires every hourly tick (no residual 6h skip)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('CRON_HANDLERS["0 * * * *"] enqueues a backup on every UTC hour, not just multiples of 6', async () => {
    vi.doMock('../src/lib/inventory', () => ({ cleanExpiredReservations: vi.fn() }));
    vi.doMock('../src/lib/sessions', () => ({ cleanExpiredSessions: vi.fn() }));
    const enqueueD1Backup = vi.fn();
    vi.doMock('../src/lib/queue-publisher', () => ({ enqueueD1Backup }));

    const { CRON_HANDLERS } = await import('../src/lib/cron-dispatch');
    const fakeEnv = { DB: {} } as any;

    // Pick a fixed UTC hour that is NOT a multiple of 6 (e.g. 7) to prove
    // the old `utcHour % 6 === 0` gate is gone.
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor() { super('2026-01-01T07:00:00Z'); }
      getUTCHours() { return 7; }
      getUTCDay() { return 4; }
      getUTCDate() { return 1; }
    }
    // @ts-expect-error test stub
    global.Date = FixedDate;
    try {
      await CRON_HANDLERS['0 * * * *'](fakeEnv);
    } finally {
      global.Date = RealDate;
    }

    expect(enqueueD1Backup).toHaveBeenCalledTimes(1);
  });
});
