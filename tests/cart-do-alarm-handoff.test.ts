/**
 * V8 §37.0 #10 — cart-do-alarm-handoff.test.ts
 *
 * Asserts the CartDO single-alarm persist→cleanup handoff (V8 §6.8, RT-006):
 *   1. A mutation arms 'persist' (now + 5 min).
 *   2. When the persist alarm fires, alarm() upserts cart_activity and arms
 *      'cleanup' (now + 30 days). It MUST NOT re-arm 'persist'.
 *   3. The cleanup fire deletes the DO.
 *
 * The re-arm bug this guards against: a persist fire that re-arms persist
 * wakes an abandoned cart ~8,640×/month and destroys the cost posture in §2.2.
 */
import { describe, it, expect, vi } from 'vitest';
import { CartDO } from '../src/do/cart-do';

const FIVE_MIN_MS = 5 * 60 * 1000;
const THIRTY_DAY_MS = 30 * 24 * 60 * 60 * 1000;

interface AlarmCall {
  purpose: string | undefined;
  scheduledAt: number;
  armedAt: number;
}

function makeMockState() {
  const storage = new Map<string, unknown>();
  let alarmAt: number | null = null;
  const setAlarmCalls: AlarmCall[] = [];
  const state = {
    storage: {
      get: vi.fn(async (k: string) => storage.get(k)),
      put: vi.fn(async (a: Record<string, unknown> | string, b?: unknown) => {
        if (typeof a === 'string') storage.set(a, b);
        else for (const [k, v] of Object.entries(a)) storage.set(k, v);
      }),
      setAlarm: vi.fn(async (scheduledAt: number) => {
        alarmAt = scheduledAt;
        setAlarmCalls.push({
          scheduledAt,
          armedAt: Date.now(),
          purpose: (storage.get('alarm_purpose') as string | undefined),
        });
      }),
      getAlarm: vi.fn(async () => alarmAt),
      delete: vi.fn(async (k: string) => { storage.delete(k); }),
      deleteAll: vi.fn(async () => { storage.clear(); alarmAt = null; }),
    },
    id: { toString: () => 'sess-test' },
  };
  return { state: state as unknown as DurableObjectState, storage, setAlarmCalls, getAlarmAt: () => alarmAt };
}

function makeMockEnv() {
  const queueSend = vi.fn(async () => {});
  return {
    CART_ACTIVITY: { send: queueSend } as unknown as Queue,
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          run: vi.fn(async () => ({ meta: { changes: 1 } })),
        })),
      })),
    } as unknown as D1Database,
    _queueSend: queueSend,
  };
}

function post(action: string, body: Record<string, unknown>) {
  return new Request(`https://do/${action}`, { method: 'POST', body: JSON.stringify(body) });
}

describe('V8 §6.8 CartDO alarm persist→cleanup handoff (RT-006)', () => {
  it('a mutation arms persist (now + ~5 min), not cleanup', async () => {
    const { state, setAlarmCalls } = makeMockState();
    const env = makeMockEnv();
    const doa = new CartDO(state, env);

    await doa.fetch(post('add', { variantId: 'v1', quantity: 1, clientVersion: 0 }));

    const last = setAlarmCalls[setAlarmCalls.length - 1];
    expect(last).toBeDefined();
    expect(last.purpose).toBe('persist');
    // Scheduled ~5 min from now (allow slack for test runtime).
    const delta = last.scheduledAt - last.armedAt;
    expect(delta).toBeGreaterThanOrEqual(FIVE_MIN_MS - 5000);
    expect(delta).toBeLessThanOrEqual(FIVE_MIN_MS + 5000);
  });

  it('persist fire arms cleanup (now + ~30 days), NOT persist', async () => {
    const { state, setAlarmCalls, storage } = makeMockState();
    const env = makeMockEnv();
    const doa = new CartDO(state, env);

    await doa.fetch(post('add', { variantId: 'v1', quantity: 2, clientVersion: 0 }));
    const persistCall = setAlarmCalls[setAlarmCalls.length - 1];
    expect(persistCall.purpose).toBe('persist');

    // Fire the persist alarm.
    await doa.alarm();

    const cleanupCall = setAlarmCalls[setAlarmCalls.length - 1];
    expect(cleanupCall.purpose).toBe('cleanup');
    // Scheduled ~30 days from now.
    const delta = cleanupCall.scheduledAt - cleanupCall.armedAt;
    expect(delta).toBeGreaterThanOrEqual(THIRTY_DAY_MS - 5000);
    expect(delta).toBeLessThanOrEqual(THIRTY_DAY_MS + 5000);
    // alarm_purpose storage key now reflects cleanup.
    expect(await state.storage.get('alarm_purpose')).toBe('cleanup');
    // DO NOT deleted yet — cleanup hasn't fired.
    expect(storage.has('cart')).toBe(true);
  });

  it('persist fire does not re-arm persist (the cost-defect guard)', async () => {
    const { state, setAlarmCalls } = makeMockState();
    const env = makeMockEnv();
    const doa = new CartDO(state, env);

    await doa.fetch(post('add', { variantId: 'v1', quantity: 1, clientVersion: 0 }));
    await doa.alarm(); // persist fire

    const purposes = setAlarmCalls.map((c) => c.purpose);
    // Sequence must be [persist, cleanup] — NOT [persist, persist].
    expect(purposes).toEqual(['persist', 'cleanup']);
    expect(purposes.filter((p) => p === 'persist')).toHaveLength(1);
  });

  it('cleanup fire upserts cart_activity then deletes the DO', async () => {
    const { state, storage } = makeMockState();
    const env = makeMockEnv();
    const doa = new CartDO(state, env);

    await doa.fetch(post('add', { variantId: 'v1', quantity: 1, clientVersion: 0 }));
    await doa.alarm(); // persist → arms cleanup
    expect(storage.has('cart')).toBe(true);
    await doa.alarm(); // cleanup → deleteAll
    expect(storage.has('cart')).toBe(false);
  });

  it('a fresh mutation after persist fire re-arms persist (supersedes pending cleanup)', async () => {
    const { state, setAlarmCalls } = makeMockState();
    const env = makeMockEnv();
    const doa = new CartDO(state, env);

    await doa.fetch(post('add', { variantId: 'v1', quantity: 1, clientVersion: 0 }));
    await doa.alarm(); // persist → cleanup armed
    // Customer returns and mutates again before 30-day cleanup.
    await doa.fetch(post('add', { variantId: 'v2', quantity: 1, clientVersion: 1 }));

    const last = setAlarmCalls[setAlarmCalls.length - 1];
    expect(last.purpose).toBe('persist');
  });

  it('empty cart on alarm cleans up immediately regardless of purpose', async () => {
    const { state, storage } = makeMockState();
    const env = makeMockEnv();
    const doa = new CartDO(state, env);

    // Add then clear → cart empty but alarm may still be armed.
    await doa.fetch(post('add', { variantId: 'v1', quantity: 1, clientVersion: 0 }));
    await doa.fetch(post('clear', { clientVersion: 1 }));
    await doa.alarm();
    expect(storage.has('cart')).toBe(false);
  });
});
