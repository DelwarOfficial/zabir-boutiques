/**
 * Durable Object Client [Master_Prompt v7.0 §2.3]
 *
 * Thin fetch() wrappers around VariantInventoryDO and IdempotencyDO so
 * the rest of the codebase can call them like normal functions.
 *
 * If the binding is missing (dev mode without wrangler, or a future
 * env without DO configured) the helper falls back to a D1-only path
 * by short-circuiting to the underlying source-of-truth check. This
 * keeps local dev frictionless while preserving the production
 * concurrency guarantee.
 */

export type VariantId = string;

export interface ReserveOk { ok: true; reservationId: string; available: number; }
export interface ReserveFail { ok: false; available: number; requested: number; }
export type ReserveResult = ReserveOk | ReserveFail;

export interface DirectSaleResult { ok: boolean; stock?: number; reserved?: number; sold?: number; available?: number; error?: string; }
export interface ReverseDirectSaleResult { ok: boolean; reversed?: boolean; auditEventId?: string; message?: string; error?: string; }
export interface AvailabilityResult { ok: true; stock: number; reserved: number; sold: number; available: number; }

interface DoEnv {
  VARIANT_INVENTORY_DO?: DurableObjectNamespace;
  IDEMPOTENCY_DO?: DurableObjectNamespace;
  CART_DO?: DurableObjectNamespace;
  DIRECT_CHECKOUT_DO?: DurableObjectNamespace;
  PROVIDER_HEALTH_DO?: DurableObjectNamespace;
}

/** Call the VariantInventoryDO for a variant. */
export async function doReserve(
  env: DoEnv & { DB: D1Database },
  variantId: VariantId,
  qty: number,
): Promise<ReserveResult> {
  if (!env.VARIANT_INVENTORY_DO) return d1OnlyReserve(env, variantId, qty);
  const id = env.VARIANT_INVENTORY_DO.idFromName(variantId);
  const stub = env.VARIANT_INVENTORY_DO.get(id);
  const res = await stub.fetch("https://do/reserve", {
    method: "POST",
    body: JSON.stringify({ qty, variantId, env: { DB: env.DB } }),
  });
  return (await res.json()) as ReserveResult;
}

export async function doRelease(
  env: DoEnv & { DB: D1Database },
  variantId: VariantId,
  qty: number,
  reservationId?: string,
): Promise<void> {
  if (!env.VARIANT_INVENTORY_DO) return;
  const id = env.VARIANT_INVENTORY_DO.idFromName(variantId);
  const stub = env.VARIANT_INVENTORY_DO.get(id);
  await stub.fetch("https://do/release", {
    method: "POST",
    body: JSON.stringify({ qty, variantId, reservationId, env: { DB: env.DB } }),
  });
}

/** Confirm a reservation: move qty from reserved → sold (decrement both stock and reserved). */
export async function doConfirm(
  env: DoEnv & { DB: D1Database },
  variantId: VariantId,
  qty: number,
  reservationId?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!env.VARIANT_INVENTORY_DO) return { ok: true };
  const id = env.VARIANT_INVENTORY_DO.idFromName(variantId);
  const stub = env.VARIANT_INVENTORY_DO.get(id);
  const res = await stub.fetch("https://do/confirm", {
    method: "POST",
    body: JSON.stringify({ qty, variantId, reservationId, env: { DB: env.DB } }),
  });
  return (await res.json()) as { ok: boolean; error?: string };
}

/** Direct sale for POS: deduct stock without reservation [Master_Prompt v7.0 §15.1] */
export async function doDirectSale(
  env: DoEnv & { DB: D1Database },
  variantId: VariantId,
  qty: number,
  invoiceId?: string,
  staffId?: string,
): Promise<DirectSaleResult> {
  if (!env.VARIANT_INVENTORY_DO) return { ok: true };
  const id = env.VARIANT_INVENTORY_DO.idFromName(variantId);
  const stub = env.VARIANT_INVENTORY_DO.get(id);
  const res = await stub.fetch("https://do/directSale", {
    method: "POST",
    body: JSON.stringify({ qty, variantId, invoiceId, staffId, channel: 'pos', env: { DB: env.DB } }),
  });
  return (await res.json()) as DirectSaleResult;
}

export async function doReverseDirectSale(
  env: DoEnv & { DB: D1Database },
  variantId: VariantId,
  qty: number,
  invoiceId: string,
  reason: string,
): Promise<ReverseDirectSaleResult> {
  if (!env.VARIANT_INVENTORY_DO) return { ok: false, error: 'DO_NOT_BOUND' };
  const id = env.VARIANT_INVENTORY_DO.idFromName(variantId);
  const stub = env.VARIANT_INVENTORY_DO.get(id);
  const res = await stub.fetch("https://do/reverseDirectSale", {
    method: "POST",
    body: JSON.stringify({ qty, variantId, invoiceId, reason, env: { DB: env.DB } }),
  });
  return (await res.json()) as ReverseDirectSaleResult;
}

/** Read-only availability check [Master_Prompt v7.0 §12.2] */
export async function doGetAvailability(
  env: DoEnv & { DB: D1Database },
  variantId: VariantId,
): Promise<AvailabilityResult> {
  if (!env.VARIANT_INVENTORY_DO) {
    const row = await env.DB
      .prepare(`SELECT quantity, reserved_quantity, COALESCE(sold_quantity, 0) AS sold_quantity FROM inventory_items WHERE variant_id = ?1`)
      .bind(variantId)
      .first<{ quantity: number; reserved_quantity: number; sold_quantity: number }>();
    const stock = row?.quantity ?? 0;
    const reserved = row?.reserved_quantity ?? 0;
    const sold = row?.sold_quantity ?? 0;
    return { ok: true, stock, reserved, sold, available: stock - reserved - sold };
  }
  const id = env.VARIANT_INVENTORY_DO.idFromName(variantId);
  const stub = env.VARIANT_INVENTORY_DO.get(id);
  const res = await stub.fetch("https://do/availability", {
    method: "POST",
    body: JSON.stringify({ variantId, env: { DB: env.DB } }),
  });
  return (await res.json()) as AvailabilityResult;
}

/** Sync the DO with the canonical D1 state (called after every D1 commit). */
export async function doSyncFromD1(
  env: DoEnv & { DB: D1Database },
  variantId: VariantId,
  stock: number,
  reserved: number,
  sold = 0,
): Promise<void> {
  if (!env.VARIANT_INVENTORY_DO) return;
  const id = env.VARIANT_INVENTORY_DO.idFromName(variantId);
  const stub = env.VARIANT_INVENTORY_DO.get(id);
  await stub.fetch("https://do/sync", {
    method: "POST",
    body: JSON.stringify({ stock, reserved, sold, variantId, env: { DB: env.DB } }),
  });
}

export interface ClaimResult {
  ok: boolean;
  claimed?: true;
  replay?: true;
  status?: "absent";
  code?: "PROCESSING";
  orderId?: string;
  responseBody?: string;
}

/** Read-only idempotency check (Master Plan §6.1 step 1). Does not claim. */
export async function doPeek(env: DoEnv, key: string): Promise<ClaimResult> {
  if (!env.IDEMPOTENCY_DO) return { ok: true, status: "absent" };
  const id = env.IDEMPOTENCY_DO.idFromName(key);
  const stub = env.IDEMPOTENCY_DO.get(id);
  const res = await stub.fetch("https://do/peek", {
    method: "POST",
    body: JSON.stringify({ key }),
  });
  return (await res.json()) as ClaimResult;
}

export async function doClaim(env: DoEnv, key: string): Promise<ClaimResult> {
  if (!env.IDEMPOTENCY_DO) return { ok: true, claimed: true };
  const id = env.IDEMPOTENCY_DO.idFromName(key);
  const stub = env.IDEMPOTENCY_DO.get(id);
  const res = await stub.fetch("https://do/claim", {
    method: "POST",
    body: JSON.stringify({ key }),
  });
  return (await res.json()) as ClaimResult;
}

export async function doComplete(
  env: DoEnv,
  key: string,
  orderId: string,
  responseBody: string,
): Promise<void> {
  if (!env.IDEMPOTENCY_DO) return;
  const id = env.IDEMPOTENCY_DO.idFromName(key);
  const stub = env.IDEMPOTENCY_DO.get(id);
  await stub.fetch("https://do/complete", {
    method: "POST",
    body: JSON.stringify({ key, orderId, responseBody }),
  });
}

export async function doFail(env: DoEnv, key: string): Promise<void> {
  if (!env.IDEMPOTENCY_DO) return;
  const id = env.IDEMPOTENCY_DO.idFromName(key);
  const stub = env.IDEMPOTENCY_DO.get(id);
  await stub.fetch("https://do/fail", {
    method: "POST",
    body: JSON.stringify({ key }),
  });
}

/**
 * Fallback path when DOs aren't bound (local dev or non-prod env).
 * Performs the same authoritative check the DO would have made.
 */
async function d1OnlyReserve(
  env: { DB: D1Database },
  variantId: VariantId,
  qty: number,
): Promise<ReserveResult> {
  const row = await env.DB
    .prepare(
      `SELECT (quantity - reserved_quantity - COALESCE(sold_quantity, 0)) AS available
       FROM inventory_items WHERE variant_id = ?1`,
    )
    .bind(variantId)
    .first<{ available: number }>();
  const available = Math.max(0, row?.available ?? 0);
  if (qty > available) return { ok: false, available, requested: qty };
  return { ok: true, reservationId: `d1-${variantId}-${Date.now()}`, available: available - qty };
}

// ─── CartDO helpers ─────────────────────────────────────────────────────

export interface CartDOItem {
  variantId: string;
  quantity: number;
  addedAt: string;
  updatedAt: string;
}

export interface CartDOState {
  items: CartDOItem[];
  lastUpdatedAt: string;
  cartVersion: number;
  couponCode: string | null;
  customerContact: string | null;
}

/** Get cart from CartDO. Returns null if DO not bound or cart empty. */
export async function doGetCart(
  env: DoEnv,
  sessionId: string,
): Promise<CartDOState | null> {
  if (!env.CART_DO) return null;
  const id = env.CART_DO.idFromName(sessionId);
  const stub = env.CART_DO.get(id);
  const res = await stub.fetch("https://do/get", {
    method: "POST",
    body: "{}",
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; cart?: CartDOState } | null;
  return data?.ok ? data.cart ?? null : null;
}

// ─── DirectCheckoutSessionDO helpers ────────────────────────────────────

export interface DirectCheckoutState {
  sessionId: string;
  productId: string;
  variantId: string;
  quantity: number;
  selectedOptions: Record<string, string>;
  createdAt: string;
  expiresAt: string;
  landingVersion: number;
  sourcePage: string | null;
  utmParams: Record<string, string> | null;
  formDraft: { name?: string; phone?: string; address?: string; shippingZone?: string } | null;
}

/** Create a direct checkout session. */
export async function doCreateDirectSession(
  env: DoEnv,
  body: { productId: string; variantId: string; quantity: number; selectedOptions?: Record<string, string>; sourcePage?: string; utmParams?: Record<string, string> },
): Promise<{ ok: boolean; session?: DirectCheckoutState; error?: string }> {
  if (!env.DIRECT_CHECKOUT_DO) return { ok: false, error: 'DO_NOT_BOUND' };
  const sessionId = crypto.randomUUID();
  const id = env.DIRECT_CHECKOUT_DO.idFromName(sessionId);
  const stub = env.DIRECT_CHECKOUT_DO.get(id);
  const res = await stub.fetch("https://do/create", {
    method: "POST",
    body: JSON.stringify({ ...body, sessionId }),
  });
  return (await res.json()) as { ok: boolean; session?: DirectCheckoutState; error?: string };
}

/** Get a direct checkout session. */
export async function doGetDirectSession(
  env: DoEnv,
  sessionId: string,
): Promise<DirectCheckoutState | null> {
  if (!env.DIRECT_CHECKOUT_DO) return null;
  const id = env.DIRECT_CHECKOUT_DO.idFromName(sessionId);
  const stub = env.DIRECT_CHECKOUT_DO.get(id);
  const res = await stub.fetch("https://do/get", {
    method: "POST",
    body: "{}",
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; session?: DirectCheckoutState } | null;
  return data?.ok ? data.session ?? null : null;
}

// ─── ProviderHealthDO helpers ───────────────────────────────────────────

export type CircuitState = 'closed' | 'open' | 'half_open';

/** Check if a provider's circuit breaker allows a request. */
export async function doCheckProviderHealth(
  env: DoEnv,
  provider: string,
): Promise<{ canProceed: boolean; state: CircuitState }> {
  if (!env.PROVIDER_HEALTH_DO) return { canProceed: true, state: 'closed' };
  const id = env.PROVIDER_HEALTH_DO.idFromName(provider);
  const stub = env.PROVIDER_HEALTH_DO.get(id);
  const res = await stub.fetch("https://do/status", {
    method: "POST",
    body: JSON.stringify({ provider }),
  });
  const data = (await res.json().catch(() => null)) as { canProceed?: boolean; state?: CircuitState } | null;
  return { canProceed: data?.canProceed ?? true, state: data?.state ?? 'closed' };
}

/** Record a provider call success or failure. */
export async function doRecordProviderResult(
  env: DoEnv,
  provider: string,
  success: boolean,
): Promise<void> {
  if (!env.PROVIDER_HEALTH_DO) return;
  const id = env.PROVIDER_HEALTH_DO.idFromName(provider);
  const stub = env.PROVIDER_HEALTH_DO.get(id);
  await stub.fetch("https://do/record", {
    method: "POST",
    body: JSON.stringify({ provider, success }),
  });
}
