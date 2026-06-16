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

export interface ReserveOk { ok: true; available: number; }
export interface ReserveFail { ok: false; available: number; requested: number; }
export type ReserveResult = ReserveOk | ReserveFail;

interface DoEnv {
  VARIANT_INVENTORY?: DurableObjectNamespace;
  IDEMPOTENCY?: DurableObjectNamespace;
}

/** Call the VariantInventoryDO for a variant. */
export async function doReserve(
  env: DoEnv & { DB: D1Database },
  variantId: VariantId,
  qty: number,
): Promise<ReserveResult> {
  if (!env.VARIANT_INVENTORY) return d1OnlyReserve(env, variantId, qty);
  const id = env.VARIANT_INVENTORY.idFromName(variantId);
  const stub = env.VARIANT_INVENTORY.get(id);
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
): Promise<void> {
  if (!env.VARIANT_INVENTORY) return;
  const id = env.VARIANT_INVENTORY.idFromName(variantId);
  const stub = env.VARIANT_INVENTORY.get(id);
  await stub.fetch("https://do/release", {
    method: "POST",
    body: JSON.stringify({ qty, variantId, env: { DB: env.DB } }),
  });
}

/** Confirm a reservation: move qty from reserved → sold (decrement both stock and reserved). */
export async function doConfirm(
  env: DoEnv & { DB: D1Database },
  variantId: VariantId,
  qty: number,
): Promise<{ ok: boolean; error?: string }> {
  if (!env.VARIANT_INVENTORY) return { ok: true };
  const id = env.VARIANT_INVENTORY.idFromName(variantId);
  const stub = env.VARIANT_INVENTORY.get(id);
  const res = await stub.fetch("https://do/confirm", {
    method: "POST",
    body: JSON.stringify({ qty, variantId, env: { DB: env.DB } }),
  });
  return (await res.json()) as { ok: boolean; error?: string };
}

/** Sync the DO with the canonical D1 state (called after every D1 commit). */
export async function doSyncFromD1(
  env: DoEnv & { DB: D1Database },
  variantId: VariantId,
  stock: number,
  reserved: number,
): Promise<void> {
  if (!env.VARIANT_INVENTORY) return;
  const id = env.VARIANT_INVENTORY.idFromName(variantId);
  const stub = env.VARIANT_INVENTORY.get(id);
  await stub.fetch("https://do/sync", {
    method: "POST",
    body: JSON.stringify({ stock, reserved, variantId, env: { DB: env.DB } }),
  });
}

export interface ClaimResult {
  ok: boolean;
  claimed?: true;
  replay?: true;
  code?: "PROCESSING";
  orderId?: string;
  responseBody?: string;
}

export async function doClaim(env: DoEnv, key: string): Promise<ClaimResult> {
  if (!env.IDEMPOTENCY) return { ok: true, claimed: true };
  const id = env.IDEMPOTENCY.idFromName(key);
  const stub = env.IDEMPOTENCY.get(id);
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
  if (!env.IDEMPOTENCY) return;
  const id = env.IDEMPOTENCY.idFromName(key);
  const stub = env.IDEMPOTENCY.get(id);
  await stub.fetch("https://do/complete", {
    method: "POST",
    body: JSON.stringify({ key, orderId, responseBody }),
  });
}

export async function doFail(env: DoEnv, key: string): Promise<void> {
  if (!env.IDEMPOTENCY) return;
  const id = env.IDEMPOTENCY.idFromName(key);
  const stub = env.IDEMPOTENCY.get(id);
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
    .prepare("SELECT (quantity - reserved_quantity) AS available FROM inventory_items WHERE variant_id = ?1")
    .bind(variantId)
    .first<{ available: number }>();
  const available = Math.max(0, row?.available ?? 0);
  if (qty > available) return { ok: false, available, requested: qty };
  return { ok: true, available: available - qty };
}
