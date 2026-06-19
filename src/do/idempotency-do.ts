import type { IdempotencyDOContract } from '../lib/contracts/idempotency-do';

/**
 * IdempotencyDO [Master_Prompt v7.0 §2.3, §6.1]
 *
 * Atomically claims and replays idempotency keys. Each key maps to a
 * single DO instance, so concurrent claim attempts for the same key are
 * serialized. The DO is the source of truth for in-flight and completed
 * keys; D1 holds a mirror for offline recovery and 24-hour replay.
 *
 * States:
 *   - absent / expired    → next claim wins
 *   - "processing"        → already in flight, return 409 PROCESSING
 *   - "complete"          → return cached response
 */
export interface IdempotencyRecord {
  status: "processing" | "complete" | "failed";
  orderId?: string;
  responseBody?: string;
  expiresAt: number; // epoch ms
}

export class IdempotencyDO implements DurableObject, IdempotencyDOContract {
  private state: DurableObjectState;
  private cache = new Map<string, IdempotencyRecord>();

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  private async load(): Promise<void> {
    if (this.cache.size > 0) return;
    const stored = (await this.state.storage.get<Record<string, IdempotencyRecord>>("keys")) ?? {};
    this.cache = new Map(Object.entries(stored));
  }

  private async persist(): Promise<void> {
    const obj: Record<string, IdempotencyRecord> = {};
    for (const [k, v] of this.cache.entries()) obj[k] = v;
    await this.state.storage.put("keys", obj);
  }

  async claim(input: { key: string }): Promise<unknown> {
    return this.fetch(new Request('https://do/claim', { method: 'POST', body: JSON.stringify(input) })).then((r) => r.json());
  }

  async complete(input: { key: string; orderId: string; responseBody: string }): Promise<unknown> {
    return this.fetch(new Request('https://do/complete', { method: 'POST', body: JSON.stringify(input) })).then((r) => r.json());
  }

  async fail(input: { key: string }): Promise<unknown> {
    return this.fetch(new Request('https://do/fail', { method: 'POST', body: JSON.stringify(input) })).then((r) => r.json());
  }

  async fetch(request: Request): Promise<Response> {
    await this.load();
    const url = new URL(request.url);
    const action = url.pathname.slice(1) || "claim";
    const body = (await request.json().catch(() => ({}))) as {
      key?: string;
      orderId?: string;
      responseBody?: string;
    };
    const key = body.key;
    if (!key) {
      return Response.json({ ok: false, error: "MISSING_KEY" }, { status: 400 });
    }

    if (action === "release") {
      this.cache.delete(key);
      await this.persist();
      return Response.json({ ok: true, released: true });
    }

    if (action === "complete") {
      const now = Date.now();
      this.cache.set(key, {
        status: "complete",
        orderId: body.orderId,
        responseBody: body.responseBody,
        expiresAt: now + 24 * 60 * 60 * 1000,
      });
      await this.persist();
      return Response.json({ ok: true, status: "complete" });
    }

    if (action === "fail") {
      this.cache.delete(key);
      await this.persist();
      return Response.json({ ok: true, status: "failed" });
    }

    if (action === "peek") {
      const peekExisting = this.cache.get(key);
      if (peekExisting && peekExisting.expiresAt > Date.now()) {
        if (peekExisting.status === "complete") {
          return Response.json({
            ok: true,
            replay: true,
            orderId: peekExisting.orderId,
            responseBody: peekExisting.responseBody,
          });
        }
        if (peekExisting.status === "processing") {
          return Response.json({ ok: false, code: "PROCESSING" }, { status: 409 });
        }
      }
      return Response.json({ ok: true, status: "absent" });
    }

    // claim
    const now = Date.now();
    const existing = this.cache.get(key);
    if (existing && existing.expiresAt > now) {
      if (existing.status === "complete") {
        return Response.json({
          ok: true,
          replay: true,
          orderId: existing.orderId,
          responseBody: existing.responseBody,
        });
      }
      return Response.json({ ok: false, code: "PROCESSING" }, { status: 409 });
    }
    this.cache.set(key, {
      status: "processing",
      expiresAt: now + 24 * 60 * 60 * 1000,
    });
    await this.persist();
    return Response.json({ ok: true, claimed: true });
  }
}
