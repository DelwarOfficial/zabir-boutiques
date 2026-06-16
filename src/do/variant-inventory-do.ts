/**
 * VariantInventoryDO [Master_Prompt v7.0 §2.3, §3.4]
 *
 * Single-threaded concurrency gate for per-variant stock reservations.
 * D1 remains the source of truth; the DO serializes "is there enough
 * available stock right now?" across Worker isolates.
 *
 * Lifecycle:
 *  - On first request, the DO loads its {stock, reserved} from D1 (sync).
 *  - reserve(qty) decrements available; if available < qty returns ok:false.
 *  - release(qty) increments available.
 *  - syncFromD1(stock, reserved) is called after every successful D1 commit
 *    (and on first hit, and from the inventory cron).
 *  - The DO is best-effort: if a sync fails, the next D1 commit re-syncs.
 *
 * Concurrency guarantee: a single DO instance is single-threaded by
 * Cloudflare's runtime, so all reserve/release calls for the same
 * variant_id are serialized. No two Workers can both observe available
 * >= qty and both commit.
 */
export class VariantInventoryDO implements DurableObject {
  private state: DurableObjectState;
  private stock = 0;
  private reserved = 0;
  private initialized = false;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  private async ensureInitialized(env: { DB?: D1Database }, variantId: string): Promise<void> {
    if (this.initialized) return;
    if (env?.DB) {
      // Pull canonical state from D1.
      const row = await env.DB
        .prepare("SELECT quantity, reserved_quantity FROM inventory_items WHERE variant_id = ?1")
        .bind(variantId)
        .first<{ quantity: number; reserved_quantity: number }>();
      if (row) {
        this.stock = row.quantity;
        this.reserved = row.reserved_quantity;
      }
    }
    this.initialized = true;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.slice(1) || "reserve";
    const body = (await request.json().catch(() => ({}))) as {
      qty?: number;
      stock?: number;
      reserved?: number;
      variantId?: string;
      env?: { DB?: D1Database };
    };
    const env = body.env ?? {};
    const variantId = (body.variantId ?? url.searchParams.get("variantId") ?? "").toString();
    await this.ensureInitialized(env, variantId);

    if (action === "sync") {
      if (typeof body.stock === "number") this.stock = body.stock;
      if (typeof body.reserved === "number") this.reserved = body.reserved;
      await this.state.storage.put({ stock: this.stock, reserved: this.reserved });
      return Response.json({ ok: true, stock: this.stock, reserved: this.reserved });
    }

    const qty = Number(body.qty ?? 0);
    if (!Number.isSafeInteger(qty) || qty <= 0) {
      return Response.json({ ok: false, error: "INVALID_QTY" }, { status: 400 });
    }

    if (action === "reserve") {
      const available = this.stock - this.reserved;
      if (qty > available) {
        return Response.json({ ok: false, available, requested: qty });
      }
      this.reserved += qty;
      await this.state.storage.put({ stock: this.stock, reserved: this.reserved });
      return Response.json({ ok: true, available: this.stock - this.reserved });
    }

    if (action === "release") {
      this.reserved = Math.max(0, this.reserved - qty);
      await this.state.storage.put({ stock: this.stock, reserved: this.reserved });
      return Response.json({ ok: true, available: this.stock - this.reserved });
    }

    if (action === "confirm") {
      // Move qty from reserved → sold: decrement both stock and reserved.
      if (this.reserved < qty || this.stock < qty) {
        return Response.json({ ok: false, error: "OVER_ALLOCATED" }, { status: 409 });
      }
      this.stock -= qty;
      this.reserved -= qty;
      await this.state.storage.put({ stock: this.stock, reserved: this.reserved });
      return Response.json({ ok: true, stock: this.stock, reserved: this.reserved });
    }

    return Response.json({ ok: false, error: "UNKNOWN_ACTION" }, { status: 400 });
  }
}
