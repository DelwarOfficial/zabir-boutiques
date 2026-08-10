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

/**
 * N-2 Case A: object ID is `variant:{id}`, not a raw variant ID (Master
 * Plan object-ID table). Safe as a same-deploy cutover — VariantInventoryDO
 * already self-hydrates from D1 (`ensureInitialized`, keyed on the
 * `variantId` passed in the request body, independent of whatever string
 * addressed the object) on every cold start, so a freshly-named object
 * correctly picks up current stock/reserved/sold with zero new DO code.
 */
function variantObjectKey(variantId: VariantId): string {
  return `variant:${variantId}`;
}

export interface ReserveOk { ok: true; reservationId: string; available: number; }
export interface ReserveFail { ok: false; available: number; requested: number; }
export type ReserveResult = ReserveOk | ReserveFail;

export interface DirectSaleResult { ok: boolean; inventory_mutation_id?: string; stock?: number; reserved?: number; sold?: number; available?: number; error?: string; }
export interface ReverseDirectSaleResult { ok: boolean; reversed?: boolean; auditEventId?: string; message?: string; error?: string; }
export interface AvailabilityResult { ok: true; stock: number; reserved: number; sold: number; available: number; }

interface DoEnv {
  VARIANT_INVENTORY_DO?: DurableObjectNamespace;
  IDEMPOTENCY_DO?: DurableObjectNamespace;
  CART_DO?: DurableObjectNamespace;
  DIRECT_CHECKOUT_DO?: DurableObjectNamespace;
  PROVIDER_HEALTH_DO?: DurableObjectNamespace;
  INVOICE_COUNTER_DO?: DurableObjectNamespace;
}

/** Call the VariantInventoryDO for a variant. */
export async function doReserve(
  env: DoEnv & { DB: D1Database },
  variantId: VariantId,
  qty: number,
): Promise<ReserveResult> {
  if (!env.VARIANT_INVENTORY_DO) return d1OnlyReserve(env, variantId, qty);
  const id = env.VARIANT_INVENTORY_DO.idFromName(variantObjectKey(variantId));
  const stub = env.VARIANT_INVENTORY_DO.get(id);
  const res = await stub.fetch("https://do/reserve", {
    method: "POST",
    body: JSON.stringify({ qty, variantId }),
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
  const id = env.VARIANT_INVENTORY_DO.idFromName(variantObjectKey(variantId));
  const stub = env.VARIANT_INVENTORY_DO.get(id);
  await stub.fetch("https://do/release", {
    method: "POST",
    body: JSON.stringify({ qty, variantId, reservationId }),
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
  const id = env.VARIANT_INVENTORY_DO.idFromName(variantObjectKey(variantId));
  const stub = env.VARIANT_INVENTORY_DO.get(id);
  const res = await stub.fetch("https://do/confirm", {
    method: "POST",
    body: JSON.stringify({ qty, variantId, reservationId }),
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
  const id = env.VARIANT_INVENTORY_DO.idFromName(variantObjectKey(variantId));
  const stub = env.VARIANT_INVENTORY_DO.get(id);
  const res = await stub.fetch("https://do/directSale", {
    method: "POST",
    body: JSON.stringify({ qty, variantId, invoiceId, staffId, channel: 'pos' }),
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
  const id = env.VARIANT_INVENTORY_DO.idFromName(variantObjectKey(variantId));
  const stub = env.VARIANT_INVENTORY_DO.get(id);
  const res = await stub.fetch("https://do/reverseDirectSale", {
    method: "POST",
    body: JSON.stringify({ qty, variantId, invoiceId, reason }),
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
  const id = env.VARIANT_INVENTORY_DO.idFromName(variantObjectKey(variantId));
  const stub = env.VARIANT_INVENTORY_DO.get(id);
  const res = await stub.fetch("https://do/availability", {
    method: "POST",
    body: JSON.stringify({ variantId }),
  });
  return (await res.json()) as AvailabilityResult;
}

/** Staff stock adjustment through VariantInventoryDO (serialized). */
export async function doAdjustStock(
  env: DoEnv & { DB: D1Database },
  variantId: VariantId,
  delta: number,
  reason: string,
  staffId: string,
  notes?: string,
  idempotencyKey?: string,
): Promise<{ ok: true; previous_stock: number; new_stock: number; adjustment_id: string } | { ok: false; error: string; current_stock?: number }> {
  // A stable idempotencyKey makes the underlying stock_adjustments insert
  // idempotent: a replay reuses the same PK, so the atomic batch rolls back
  // the quantity update instead of double-restocking.
  const adjustmentId = idempotencyKey ?? crypto.randomUUID();
  if (!env.VARIANT_INVENTORY_DO) {
    console.warn('[do-client] VARIANT_INVENTORY_DO not bound, falling back to direct D1 mutation. Production should always bind DO.');
    // K-44: the SELECT-then-UPDATE below used to read `currentStock`
    // outside the atomic batch, then build the UPDATE and negativity
    // check from that stale read — a genuine TOCTOU race between two
    // concurrent adjustments in the D1-fallback path (no DO bound).
    // Guard the UPDATE itself so it only succeeds when the resulting
    // quantity would stay non-negative, and treat `meta.changes === 0` as
    // the real "insufficient stock" signal instead of a pre-read guess.
    const row = await env.DB
      .prepare(`SELECT quantity FROM inventory_items WHERE variant_id = ?1`)
      .bind(variantId)
      .first<{ quantity: number }>();
    const currentStock = row?.quantity ?? 0;
    const newStock = currentStock + delta;
    // Guarded UPDATE runs alone first — if the audit INSERT were batched
    // atomically alongside it, a rejected (0-row) UPDATE would still leave
    // a misleading stock_adjustments row behind (D1 batch runs every
    // statement regardless of another statement's row count). Only
    // INSERT the audit row once the UPDATE is confirmed to have applied.
    const updateResult = await env.DB
      .prepare(`UPDATE inventory_items SET quantity = quantity + ?1, updated_at = datetime('now') WHERE variant_id = ?2 AND quantity + ?1 >= 0`)
      .bind(delta, variantId)
      .run();
    if (updateResult.meta.changes !== 1) {
      const latest = await env.DB.prepare(`SELECT quantity FROM inventory_items WHERE variant_id = ?1`).bind(variantId).first<{ quantity: number }>();
      return { ok: false, error: 'INSUFFICIENT_STOCK', current_stock: latest?.quantity ?? currentStock };
    }
    await env.DB
      .prepare(`INSERT INTO stock_adjustments (id, variant_id, delta, reason, prev_quantity, new_quantity, notes, adjusted_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))`)
      .bind(adjustmentId, variantId, delta, reason, currentStock, newStock, notes ?? null, staffId)
      .run();
    return { ok: true, previous_stock: currentStock, new_stock: newStock, adjustment_id: adjustmentId };
  }
  const id = env.VARIANT_INVENTORY_DO.idFromName(variantObjectKey(variantId));
  const stub = env.VARIANT_INVENTORY_DO.get(id);
  const res = await stub.fetch("https://do/adjustStock", {
    method: "POST",
    body: JSON.stringify({ variantId, stock: delta, reason, staffId, notes, reservationId: adjustmentId }),
  });
  return (await res.json()) as { ok: true; previous_stock: number; new_stock: number; adjustment_id: string } | { ok: false; error: string; current_stock?: number };
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
  const id = env.VARIANT_INVENTORY_DO.idFromName(variantObjectKey(variantId));
  const stub = env.VARIANT_INVENTORY_DO.get(id);
  await stub.fetch("https://do/sync", {
    method: "POST",
    body: JSON.stringify({ stock, reserved, sold, variantId }),
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

/**
 * N-2 Case C: object ID is `idem:{scope}:{idempotency_key}` (Master Plan
 * §6.1 step 1 / object-ID table) — a raw client-supplied key is never used
 * as the global object ID by itself. `scope` is the checkout session
 * identity: cart session_id (guest checkout), Buy Now session_id, or staff
 * session id. Two different sessions coincidentally reusing the same
 * client-generated idempotency key must not collide on one object.
 */
function idemObjectKey(scope: string, key: string): string {
  return `idem:${scope}:${key}`;
}

/** Read-only idempotency check (Master Plan §6.1 step 1). Does not claim. */
export async function doPeek(env: DoEnv, scope: string, key: string): Promise<ClaimResult> {
  if (!env.IDEMPOTENCY_DO) return { ok: true, status: "absent" };
  const id = env.IDEMPOTENCY_DO.idFromName(idemObjectKey(scope, key));
  const stub = env.IDEMPOTENCY_DO.get(id);
  const res = await stub.fetch("https://do/peek", {
    method: "POST",
    body: JSON.stringify({ key }),
  });
  return (await res.json()) as ClaimResult;
}

export async function doClaim(env: DoEnv, scope: string, key: string): Promise<ClaimResult> {
  if (!env.IDEMPOTENCY_DO) return { ok: true, claimed: true };
  const id = env.IDEMPOTENCY_DO.idFromName(idemObjectKey(scope, key));
  const stub = env.IDEMPOTENCY_DO.get(id);
  const res = await stub.fetch("https://do/claim", {
    method: "POST",
    body: JSON.stringify({ key }),
  });
  return (await res.json()) as ClaimResult;
}

export async function doComplete(
  env: DoEnv,
  scope: string,
  key: string,
  orderId: string,
  responseBody: string,
): Promise<void> {
  if (!env.IDEMPOTENCY_DO) return;
  const id = env.IDEMPOTENCY_DO.idFromName(idemObjectKey(scope, key));
  const stub = env.IDEMPOTENCY_DO.get(id);
  await stub.fetch("https://do/complete", {
    method: "POST",
    body: JSON.stringify({ key, orderId, responseBody }),
  });
}

export async function doFail(env: DoEnv, scope: string, key: string): Promise<void> {
  if (!env.IDEMPOTENCY_DO) return;
  const id = env.IDEMPOTENCY_DO.idFromName(idemObjectKey(scope, key));
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

import type { CartCustomerContact, CartItem, CartDOState as CartDOStateInternal } from '../do/cart-do';

export type { CartCustomerContact, CartItem };
export type CartDOState = CartDOStateInternal;

function cartObjectKey(sessionId: string): string {
  return `cart:${sessionId}`;
}

/**
 * N-2 Case A (CartDO): unlike VariantInventoryDO, CartDO has no usable D1
 * mirror to self-hydrate from — `cart_activity` is an aggregate projection
 * (item counts only, no item list) and `guest_carts` (which would have
 * full fidelity) is declared but never actually written or read anywhere.
 * So this resolves through a real peer-DO migration: probe the new
 * (prefixed) object's `/init-status`; if it's never been touched, read the
 * OLD (raw-named) object's real state via its existing `/get` action and
 * hand it to the new object's `/hydrate` action. The hydrate handler is
 * idempotent and race-free (CartDO serializes all requests to one object),
 * so concurrent first-touches are safe.
 */
export async function resolveCartStub(
  namespace: DurableObjectNamespace,
  sessionId: string,
): Promise<DurableObjectStub> {
  const stub = namespace.get(namespace.idFromName(cartObjectKey(sessionId)));
  const statusRes = await stub.fetch("https://do/init-status", { method: "POST", body: "{}" }).catch(() => null);
  const status = statusRes ? ((await statusRes.json().catch(() => null)) as { initialized?: boolean } | null) : null;
  if (status?.initialized === false) {
    const oldStub = namespace.get(namespace.idFromName(sessionId));
    const oldRes = await oldStub.fetch("https://do/get", { method: "POST", body: "{}" }).catch(() => null);
    const oldData = oldRes ? ((await oldRes.json().catch(() => null)) as { ok?: boolean; cart?: CartDOState } | null) : null;
    await stub.fetch("https://do/hydrate", {
      method: "POST",
      body: JSON.stringify({ cart: oldData?.ok ? oldData.cart : null }),
    }).catch(() => {});
  }
  return stub;
}

/** Get cart from CartDO. Returns null if DO not bound or cart empty. */
export async function doGetCart(
  env: DoEnv,
  sessionId: string,
): Promise<CartDOState | null> {
  if (!env.CART_DO) return null;
  const stub = await resolveCartStub(env.CART_DO, sessionId);
  const res = await stub.fetch("https://do/get", {
    method: "POST",
    body: "{}",
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; cart?: CartDOState } | null;
  return data?.ok ? data.cart ?? null : null;
}

/** Add item to CartDO. */
export async function doAddToCart(
  env: DoEnv,
  sessionId: string,
  variantId: string,
  quantity: number,
  clientVersion?: number,
): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number; error?: string }> {
  if (!env.CART_DO) return { ok: false, error: 'DO_NOT_BOUND' };
  const stub = await resolveCartStub(env.CART_DO, sessionId);
  const res = await stub.fetch("https://do/add", {
    method: "POST",
    body: JSON.stringify({ variantId, quantity, clientVersion }),
  });
  return res.json() as Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number; error?: string }>;
}

/** Remove item from CartDO. */
export async function doRemoveFromCart(
  env: DoEnv,
  sessionId: string,
  variantId: string,
  clientVersion?: number,
): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }> {
  if (!env.CART_DO) return { ok: false };
  const stub = await resolveCartStub(env.CART_DO, sessionId);
  const res = await stub.fetch("https://do/remove", {
    method: "POST",
    body: JSON.stringify({ variantId, clientVersion }),
  });
  return res.json() as Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }>;
}

/** Change item quantity in CartDO. */
export async function doChangeCartQuantity(
  env: DoEnv,
  sessionId: string,
  variantId: string,
  quantity: number,
  clientVersion?: number,
): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number; error?: string; code?: string }> {
  if (!env.CART_DO) return { ok: false, error: 'DO_NOT_BOUND' };
  const stub = await resolveCartStub(env.CART_DO, sessionId);
  const res = await stub.fetch("https://do/quantity", {
    method: "POST",
    body: JSON.stringify({ variantId, quantity, clientVersion }),
  });
  return res.json() as Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number; error?: string; code?: string }>;
}

/** Clear CartDO. */
export async function doClearCart(
  env: DoEnv,
  sessionId: string,
  clientVersion?: number,
): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }> {
  if (!env.CART_DO) return { ok: false };
  const stub = await resolveCartStub(env.CART_DO, sessionId);
  const res = await stub.fetch("https://do/clear", {
    method: "POST",
    body: JSON.stringify({ clientVersion }),
  });
  return res.json() as Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }>;
}

/** Apply coupon to CartDO. */
export async function doApplyCoupon(
  env: DoEnv,
  sessionId: string,
  couponCode: string,
  clientVersion?: number,
): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }> {
  if (!env.CART_DO) return { ok: false };
  const stub = await resolveCartStub(env.CART_DO, sessionId);
  const res = await stub.fetch("https://do/coupon", {
    method: "POST",
    body: JSON.stringify({ couponCode, clientVersion }),
  });
  return res.json() as Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }>;
}

/** Remove coupon from CartDO. */
export async function doRemoveCoupon(
  env: DoEnv,
  sessionId: string,
  clientVersion?: number,
): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }> {
  if (!env.CART_DO) return { ok: false };
  const stub = await resolveCartStub(env.CART_DO, sessionId);
  const res = await stub.fetch("https://do/coupon", {
    method: "POST",
    body: JSON.stringify({ couponCode: null, clientVersion }),
  });
  return res.json() as Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }>;
}

/** Update customer contact on CartDO. */
export async function doUpdateCustomerContact(
  env: DoEnv,
  sessionId: string,
  customerContact: CartCustomerContact,
  clientVersion?: number,
): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }> {
  if (!env.CART_DO) return { ok: false };
  const stub = await resolveCartStub(env.CART_DO, sessionId);
  const res = await stub.fetch("https://do/contact", {
    method: "POST",
    body: JSON.stringify({ customerContact, clientVersion }),
  });
  return res.json() as Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }>;
}

/** Merge items into CartDO (for guest login recovery). */
export async function doMergeCart(
  env: DoEnv,
  sessionId: string,
  items: CartItem[],
  clientVersion?: number,
): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }> {
  if (!env.CART_DO) return { ok: false };
  const stub = await resolveCartStub(env.CART_DO, sessionId);
  const res = await stub.fetch("https://do/merge", {
    method: "POST",
    body: JSON.stringify({ items, clientVersion }),
  });
  return res.json() as Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }>;
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

export function buyObjectKey(sessionId: string): string {
  return `buy:${sessionId}`;
}

/**
 * N-2 Case A (DirectCheckoutSessionDO): no D1 mirror has full fidelity —
 * `checkout_sessions` is missing bindingHash and formDraft — and this DO
 * has no env.DB access at all, so this is pure peer-DO migration like
 * CartDO. Uses the DO's own `export-for-migration` action (deliberately
 * not the bindingSecret-gated `get`) to read the old object's real state.
 */
export async function resolveDirectCheckoutStub(
  namespace: DurableObjectNamespace,
  sessionId: string,
): Promise<DurableObjectStub> {
  const stub = namespace.get(namespace.idFromName(buyObjectKey(sessionId)));
  const statusRes = await stub.fetch("https://do/init-status", { method: "POST", body: "{}" }).catch(() => null);
  const status = statusRes ? ((await statusRes.json().catch(() => null)) as { initialized?: boolean } | null) : null;
  if (status?.initialized === false) {
    const oldStub = namespace.get(namespace.idFromName(sessionId));
    const oldRes = await oldStub.fetch("https://do/export-for-migration", { method: "POST", body: "{}" }).catch(() => null);
    const oldData = oldRes ? ((await oldRes.json().catch(() => null)) as { ok?: boolean; session?: DirectCheckoutState | null } | null) : null;
    await stub.fetch("https://do/hydrate", {
      method: "POST",
      body: JSON.stringify({ session: oldData?.ok ? oldData.session : null }),
    }).catch(() => {});
  }
  return stub;
}

/** Create a direct checkout session. Always a fresh sessionId — never needs migration. */
export async function doCreateDirectSession(
  env: DoEnv,
  body: { productId: string; variantId: string; quantity: number; selectedOptions?: Record<string, string>; sourcePage?: string; utmParams?: Record<string, string> },
): Promise<{ ok: boolean; session?: DirectCheckoutState; error?: string }> {
  if (!env.DIRECT_CHECKOUT_DO) return { ok: false, error: 'DO_NOT_BOUND' };
  const sessionId = crypto.randomUUID();
  const id = env.DIRECT_CHECKOUT_DO.idFromName(buyObjectKey(sessionId));
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
  const stub = await resolveDirectCheckoutStub(env.DIRECT_CHECKOUT_DO, sessionId);
  const res = await stub.fetch("https://do/get", {
    method: "POST",
    body: "{}",
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; session?: DirectCheckoutState } | null;
  return data?.ok ? data.session ?? null : null;
}

// ─── ProviderHealthDO helpers ───────────────────────────────────────────

export type CircuitState = 'closed' | 'open' | 'half_open';

/**
 * N-2 Case A: object ID is `provider:{name}`. Direct cutover, no hydrate
 * needed — ensureLoaded() in ProviderHealthDO never reads D1 on cold
 * start anyway (circuit state is DO-storage-only), so a freshly-addressed
 * object starting at the default closed/healthy state is exactly what
 * already happens on any ordinary DO eviction today. Worst case after
 * cutover: a few requests reach a still-unhealthy provider before its
 * failures re-open the circuit — bounded, self-correcting, not data loss.
 */
function providerObjectKey(provider: string): string {
  return `provider:${provider}`;
}

/** Check if a provider's circuit breaker allows a request. */
export async function doCheckProviderHealth(
  env: DoEnv,
  provider: string,
): Promise<{ canProceed: boolean; state: CircuitState }> {
  if (!env.PROVIDER_HEALTH_DO) return { canProceed: true, state: 'closed' };
  const id = env.PROVIDER_HEALTH_DO.idFromName(providerObjectKey(provider));
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
  const id = env.PROVIDER_HEALTH_DO.idFromName(providerObjectKey(provider));
  const stub = env.PROVIDER_HEALTH_DO.get(id);
  await stub.fetch("https://do/record", {
    method: "POST",
    body: JSON.stringify({ provider, success }),
  });
}

/**
 * INV-3 fix: InvoiceCounterDO was bound and exported but never called —
 * invoices.ts used a racy D1 SELECT MAX+1 read-modify-write instead. The
 * DO serializes serial issuance per UTC day (single-threaded per object),
 * eliminating the read-modify-write race entirely rather than catching
 * duplicates after the fact via a UNIQUE-constraint retry loop.
 *
 * Falls back to null when the DO is not bound (e.g. free-tier deploy);
 * the caller is responsible for falling back to the D1 retry path.
 */
export async function doNextInvoiceNumber(
  env: DoEnv,
  dateKey: string,
  staffId: string,
): Promise<{ receipt_no: string; seq: number } | null> {
  if (!env.INVOICE_COUNTER_DO) return null;
  const id = env.INVOICE_COUNTER_DO.idFromName(`invoice-counter:${dateKey}`);
  const stub = env.INVOICE_COUNTER_DO.get(id);
  const res = await stub.fetch("https://do/next", {
    method: "POST",
    body: JSON.stringify({ staffId }),
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; receipt_no?: string; seq?: number } | null;
  if (!data?.ok || !data.receipt_no) return null;
  return { receipt_no: data.receipt_no, seq: data.seq ?? 0 };
}
