import type { VariantInventoryDOContract } from '../lib/contracts/variant-inventory-do';

/**
 * VariantInventoryDO [Master_Prompt v7.0 §6.6, §12.2]
 *
 * Single-threaded concurrency gate for per-variant stock reservations.
 * D1 remains the source of truth; the DO serializes "is there enough
 * available stock right now?" across Worker isolates.
 *
 * available = stock - reserved - sold (migration 0017)
 *
 * Actions:
 *   reserve    — Hold stock for checkout. Returns reservation_id.
 *   release    — Release a reservation by reservation_id or qty.
 *   confirm    — Convert reservation to sold (online order confirmed).
 *   directSale — POS counter sale: deduct stock without reservation.
 *   availability — Read-only stock check.
 *   sync       — Push D1 state into DO (used after D1 writes).
 */
export class VariantInventoryDO implements DurableObject, VariantInventoryDOContract {
  private state: DurableObjectState;
  private stock = 0;
  private reserved = 0;
  private sold = 0;
  private initialized = false;
  private reservations = new Map<string, { qty: number; expiresAt: number }>();

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
    // Load persisted reservations
    const stored = await this.state.storage.get<Record<string, { qty: number; expiresAt: number }>>('reservations');
    if (stored) this.reservations = new Map(Object.entries(stored));
    this.initialized = true;
  }

  private async persistState(): Promise<void> {
    await this.state.storage.put({
      stock: this.stock,
      reserved: this.reserved,
      sold: this.sold,
      reservations: Object.fromEntries(this.reservations),
    });
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
      reservationId?: string;
      invoiceId?: string;
      staffId?: string;
      channel?: string;
      reason?: string;
      env?: { DB?: D1Database };
    };
    const env = body.env ?? {};
    const variantId = (body.variantId ?? url.searchParams.get("variantId") ?? "").toString();
    await this.ensureInitialized(env, variantId);

    if (action === "sync") {
      if (typeof body.stock === "number") this.stock = body.stock;
      if (typeof body.reserved === "number") this.reserved = body.reserved;
      if (typeof body.sold === "number") this.sold = body.sold;
      await this.persistState();
      return Response.json({ ok: true, stock: this.stock, reserved: this.reserved, sold: this.sold });
    }

    // Read-only availability check [Master_Prompt v7.0 §12.2]
    if (action === "availability") {
      return Response.json({
        ok: true,
        stock: this.stock,
        reserved: this.reserved,
        sold: this.sold,
        available: this.available(),
      });
    }

    const qty = Number(body.qty ?? 0);
    if (!Number.isSafeInteger(qty) || qty <= 0) {
      return Response.json({ ok: false, error: "INVALID_QTY" }, { status: 400 });
    }

    // Reserve: returns reservation_id for tracking [Master_Prompt v7.0 §11.3]
    if (action === "reserve") {
      const available = this.available();
      if (qty > available) {
        return Response.json({ ok: false, available, requested: qty });
      }
      const reservationId = crypto.randomUUID();
      this.reserved += qty;
      this.reservations.set(reservationId, { qty, expiresAt: Date.now() + 10 * 60 * 1000 });
      await this.persistState();
      return Response.json({ ok: true, reservationId, available: this.available() });
    }

    // Release by reservation_id or by qty [Master_Prompt v7.0 §11.3]
    if (action === "release") {
      const reservationId = body.reservationId;
      if (reservationId && this.reservations.has(reservationId)) {
        const res = this.reservations.get(reservationId)!;
        this.reserved = Math.max(0, this.reserved - res.qty);
        this.reservations.delete(reservationId);
      } else {
        this.reserved = Math.max(0, this.reserved - qty);
      }
      await this.persistState();
      return Response.json({ ok: true, available: this.available() });
    }

    // Confirm reservation → sold [Master_Prompt v7.0 §11.3]
    if (action === "confirm") {
      if (this.reserved < qty) {
        return Response.json({ ok: false, error: "OVER_ALLOCATED" }, { status: 409 });
      }
      this.stock -= qty;
      this.reserved -= qty;
      this.sold += qty;
      // Remove the reservation if provided
      if (body.reservationId) this.reservations.delete(body.reservationId);
      await this.persistState();
      return Response.json({ ok: true, stock: this.stock, reserved: this.reserved, sold: this.sold });
    }

    // Direct sale for POS [Master_Prompt v7.0 §15.1]
    // Deducts stock immediately without reservation flow.
    if (action === "directSale") {
      const available = this.available();
      if (qty > available) {
        return Response.json({ ok: false, available, requested: qty });
      }
      this.stock -= qty;
      this.sold += qty;
      if (env.DB && body.invoiceId) {
        const updated = await env.DB.prepare(
          `UPDATE inventory_items
           SET quantity = quantity - ?1, sold_quantity = COALESCE(sold_quantity, 0) + ?1, updated_at = datetime('now')
           WHERE variant_id = ?2 AND quantity >= ?1`,
        ).bind(qty, variantId).run();
        if (updated.meta.changes !== 1) {
          this.stock += qty;
          this.sold = Math.max(0, this.sold - qty);
          await this.persistState();
          return Response.json({ ok: false, error: "CONFLICT", available: this.available() }, { status: 409 });
        }
      }
      await this.persistState();
      return Response.json({
        ok: true,
        stock: this.stock,
        reserved: this.reserved,
        sold: this.sold,
        available: this.available(),
      });
    }

    if (action === "reverseDirectSale") {
      const auditEventId = crypto.randomUUID();
      const reversalKey = `pos_reversal:${body.invoiceId}:${variantId}:${qty}`;
      const existing = await this.state.storage.get<string>(reversalKey);
      if (existing) {
        return Response.json({ ok: true, reversed: false, auditEventId: existing, message: "already_reversed" });
      }

      this.stock += qty;
      this.sold = Math.max(0, this.sold - qty);

      if (env.DB) {
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE inventory_items
             SET quantity = quantity + ?1, sold_quantity = MAX(COALESCE(sold_quantity, 0) - ?1, 0), updated_at = datetime('now')
             WHERE variant_id = ?2`,
          ).bind(qty, variantId),
          env.DB.prepare(
            `INSERT INTO stock_adjustments (id, variant_id, delta, reason, adjusted_by, created_at)
             VALUES (?1, ?2, ?3, 'pos_reversal', NULL, datetime('now'))`,
          ).bind(auditEventId, variantId, qty),
        ], { atomic: true });
      }

      await this.state.storage.put(reversalKey, auditEventId);
      await this.persistState();
      return Response.json({ ok: true, reversed: true, auditEventId });
    }

    return Response.json({ ok: false, error: "UNKNOWN_ACTION" }, { status: 400 });
  }

  async reserve(input: { variant_id: string; quantity: number; checkout_id: string }): Promise<{ reservation_id: string } | { error: 'INSUFFICIENT_STOCK'; available: number }> {
    const res = await this.fetch(new Request('https://do/reserve', { method: 'POST', body: JSON.stringify({ variantId: input.variant_id, qty: input.quantity }) }));
    const data = await res.json() as { ok?: boolean; reservationId?: string; available?: number };
    return data.ok ? { reservation_id: data.reservationId ?? '' } : { error: 'INSUFFICIENT_STOCK', available: data.available ?? 0 };
  }

  async release(input: { reservation_id: string; reason: string }): Promise<{ released: boolean; already_released?: boolean }> {
    const res = await this.fetch(new Request('https://do/release', { method: 'POST', body: JSON.stringify({ reservationId: input.reservation_id, qty: 1 }) }));
    return res.ok ? { released: true } : { released: false, already_released: true };
  }

  async confirm(input: { reservation_id: string; order_id: string }): Promise<{ confirmed: true } | { error: 'RESERVATION_NOT_FOUND' | 'ALREADY_CONFIRMED' }> {
    const existing = this.reservations.get(input.reservation_id);
    if (!existing) return { error: 'RESERVATION_NOT_FOUND' };
    const res = await this.fetch(new Request('https://do/confirm', { method: 'POST', body: JSON.stringify({ reservationId: input.reservation_id, qty: existing.qty }) }));
    return res.ok ? { confirmed: true } : { error: 'ALREADY_CONFIRMED' };
  }

  async directSale(input: { variant_id: string; quantity: number; invoice_id: string; staff_id: string; channel: 'pos' }): Promise<{ success: true } | { error: 'INSUFFICIENT_STOCK'; available: number } | { error: 'CONFLICT'; message: string }> {
    const res = await this.fetch(new Request('https://do/directSale', { method: 'POST', body: JSON.stringify({ variantId: input.variant_id, qty: input.quantity, invoiceId: input.invoice_id, staffId: input.staff_id, channel: input.channel }) }));
    const data = await res.json() as { ok?: boolean; error?: string; available?: number };
    if (data.ok) return { success: true };
    if (data.error === 'CONFLICT') return { error: 'CONFLICT', message: 'conflict' };
    return { error: 'INSUFFICIENT_STOCK', available: data.available ?? 0 };
  }

  async reverseDirectSale(input: { variant_id: string; quantity: number; invoice_id: string; reason: string }): Promise<{ reversed: true; audit_event_id: string } | { reversed: false; audit_event_id: string; message: 'already_reversed' }> {
    const res = await this.fetch(new Request('https://do/reverseDirectSale', { method: 'POST', body: JSON.stringify({ variantId: input.variant_id, qty: input.quantity, invoiceId: input.invoice_id, reason: input.reason }) }));
    const data = await res.json() as { reversed?: boolean; auditEventId?: string; message?: string };
    return data.reversed ? { reversed: true, audit_event_id: data.auditEventId ?? '' } : { reversed: false, audit_event_id: data.auditEventId ?? '', message: 'already_reversed' };
  }

  async getAvailability(input: { variant_id: string }): Promise<{ stock: number; reserved: number; sold: number; available: number }> {
    await this.ensureInitialized({}, input.variant_id);
    return { stock: this.stock, reserved: this.reserved, sold: this.sold, available: this.available() };
  }
}
