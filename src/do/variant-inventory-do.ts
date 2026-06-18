/**
 * VariantInventoryDO [Master_Prompt v7.0 §2.3, §3.4]
 *
 * Single-threaded concurrency gate for per-variant stock reservations.
 * D1 remains the source of truth; the DO serializes "is there enough
 * available stock right now?" across Worker isolates.
 *
 * available = stock - reserved - sold (migration 0017)
 */
export class VariantInventoryDO implements DurableObject {
  private state: DurableObjectState;
  private stock = 0;
  private reserved = 0;
  private sold = 0;
  private initialized = false;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  private available(): number {
    return this.stock - this.reserved - this.sold;
  }

  private async ensureInitialized(env: { DB?: D1Database }, variantId: string): Promise<void> {
    if (this.initialized) return;
    if (env?.DB) {
      const row = await env.DB
        .prepare(
          `SELECT quantity, reserved_quantity, COALESCE(sold_quantity, 0) AS sold_quantity
           FROM inventory_items WHERE variant_id = ?1`,
        )
        .bind(variantId)
        .first<{ quantity: number; reserved_quantity: number; sold_quantity: number }>();
      if (row) {
        this.stock = row.quantity;
        this.reserved = row.reserved_quantity;
        this.sold = row.sold_quantity;
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
      sold?: number;
      variantId?: string;
      env?: { DB?: D1Database };
    };
    const env = body.env ?? {};
    const variantId = (body.variantId ?? url.searchParams.get("variantId") ?? "").toString();
    await this.ensureInitialized(env, variantId);

    if (action === "sync") {
      if (typeof body.stock === "number") this.stock = body.stock;
      if (typeof body.reserved === "number") this.reserved = body.reserved;
      if (typeof body.sold === "number") this.sold = body.sold;
      await this.state.storage.put({ stock: this.stock, reserved: this.reserved, sold: this.sold });
      return Response.json({ ok: true, stock: this.stock, reserved: this.reserved, sold: this.sold });
    }

    const qty = Number(body.qty ?? 0);
    if (!Number.isSafeInteger(qty) || qty <= 0) {
      return Response.json({ ok: false, error: "INVALID_QTY" }, { status: 400 });
    }

    if (action === "reserve") {
      const available = this.available();
      if (qty > available) {
        return Response.json({ ok: false, available, requested: qty });
      }
      this.reserved += qty;
      await this.state.storage.put({ stock: this.stock, reserved: this.reserved, sold: this.sold });
      return Response.json({ ok: true, available: this.available() });
    }

    if (action === "release") {
      this.reserved = Math.max(0, this.reserved - qty);
      await this.state.storage.put({ stock: this.stock, reserved: this.reserved, sold: this.sold });
      return Response.json({ ok: true, available: this.available() });
    }

    if (action === "confirm") {
      if (this.reserved < qty || this.available() < qty) {
        return Response.json({ ok: false, error: "OVER_ALLOCATED" }, { status: 409 });
      }
      this.stock -= qty;
      this.reserved -= qty;
      this.sold += qty;
      await this.state.storage.put({ stock: this.stock, reserved: this.reserved, sold: this.sold });
      return Response.json({ ok: true, stock: this.stock, reserved: this.reserved, sold: this.sold });
    }

    return Response.json({ ok: false, error: "UNKNOWN_ACTION" }, { status: 400 });
  }
}