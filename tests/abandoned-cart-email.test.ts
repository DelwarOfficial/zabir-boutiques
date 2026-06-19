import { describe, expect, it, vi } from 'vitest';
import { sendAbandonedCartEmail } from '../src/lib/email';

function createDb() {
  return {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
  } as unknown as D1Database;
}

describe('abandoned cart email', () => {
  it('sends abandoned cart email through the selected provider path', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'msg-1' }),
    } as Response);

    const result = await sendAbandonedCartEmail(
      { DB: createDb(), RESEND_API_KEY: 'resend-key' },
      {
        session_id: 'sess-1',
        name: 'Nadia',
        email: 'nadia@example.com',
        recovery_url: 'https://zabirboutiques.com/checkout?session_id=sess-1',
      },
    );

    expect(result.ok).toBe(true);
    expect((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body).toContain('sess-1');
  });
});
