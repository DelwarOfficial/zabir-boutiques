/**
 * Checkout Authoritative Pricing [v6.8B Security Patch]
 *
 * Closes Issue #2 (checkout price tampering): the server NEVER trusts
 * client-supplied money fields. All prices come from D1 (source of truth).
 *
 * Money is always INTEGER paisa. No floating point.
 */
import { assertPaisa, multiplyPaisa, addPaisa, type Paisa } from './money';

export type CheckoutCartItem = {
  variantId: string;
  qty: number;
};

export type VariantSnapshot = {
  variant_id: string;
  product_id: string;
  product_name: string;
  size: string | null;
  color: string | null;
  sku: string;
  price_paisa: number;
};

type VariantSnapshotRow = {
  variant_id: string;
  product_id: string;
  product_name: string;
  size: string | null;
  color: string | null;
  sku: string;
  price_paisa: number | null;
};

const MAX_CART_ITEMS = 10;

/**
 * Load authoritative variant + product data from D1 in a single SELECT.
 * - Only published products and non-deleted variants are eligible.
 * - Variant price_paisa may be NULL in schema; it falls back to the product price.
 * - Validates each loaded price is a non-negative integer.
 *
 * Throws:
 * - INVALID_CART_SIZE        when 0 or > MAX_CART_ITEMS unique variant ids
 * - INVALID_DB_PRICE:<id>    when a loaded price is not a non-negative integer
 */
export async function loadVariantSnapshots(
  db: D1Database,
  items: CheckoutCartItem[]
): Promise<Map<string, VariantSnapshot>> {
  const uniqueIds = [...new Set(items.map((item) => item.variantId).filter(Boolean))];

  if (uniqueIds.length === 0 || uniqueIds.length > MAX_CART_ITEMS) {
    throw new Error('INVALID_CART_SIZE');
  }

  const placeholders = uniqueIds.map((_, index) => `?${index + 1}`).join(', ');
  const rows = await db.prepare(
    `SELECT v.id AS variant_id,
            v.product_id AS product_id,
            p.name AS product_name,
            v.size AS size,
            v.color AS color,
            v.sku AS sku,
            COALESCE(v.price_paisa, p.price_paisa) AS price_paisa
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     WHERE v.id IN (${placeholders})
       AND v.is_deleted = 0
       AND p.status = 'published'`
  ).bind(...uniqueIds).all<VariantSnapshotRow>();

  const snapshots = new Map<string, VariantSnapshot>();
  for (const row of rows.results ?? []) {
    const price = row.price_paisa;
    if (price == null || !Number.isSafeInteger(price) || price < 0) {
      throw new Error(`INVALID_DB_PRICE:${row.variant_id}`);
    }
    snapshots.set(row.variant_id, {
      variant_id: row.variant_id,
      product_id: row.product_id,
      product_name: row.product_name,
      size: row.size,
      color: row.color,
      sku: row.sku,
      price_paisa: price
    });
  }

  return snapshots;
}

/**
 * Compute the authoritative subtotal purely from D1 snapshot prices.
 *
 * Throws:
 * - VARIANT_NOT_FOUND:<id>   when a cart item has no matching snapshot
 * - INVALID_QTY              when a quantity is not a positive integer
 */
export function calculateAuthoritativeSubtotal(
  items: CheckoutCartItem[],
  snapshots: Map<string, VariantSnapshot>
): Paisa {
  const lineTotals = items.map((item) => {
    const snapshot = snapshots.get(item.variantId);
    if (!snapshot) throw new Error(`VARIANT_NOT_FOUND:${item.variantId}`);
    if (!Number.isSafeInteger(item.qty) || item.qty < 1) throw new Error('INVALID_QTY');
    return multiplyPaisa(snapshot.price_paisa, item.qty);
  });
  return addPaisa(lineTotals);
}

/**
 * Detect (and warn about) client-supplied money fields. These are NEVER used
 * to compute totals; they are display-only hints from the browser.
 *
 * P1-004 audit fix: in addition to logging, emit an Analytics Engine
 * metric so repeated tampering from the same IP becomes observable
 * in the dashboard. If `env` is provided and the same source sends > 10
 * tamper attempts in 5 minutes, write a low_stock_alerts row so staff
 * see the abuse on the dashboard.
 */
export function assertNoClientMoneyTrust(
  body: Record<string, unknown>,
  env?: { DB?: D1Database; ANALYTICS?: AnalyticsEngineDataset; CACHE?: KVNamespace },
  context?: { ip?: string | null; now?: string },
): void {
  const clientMoneyFields = ['unit_price_paisa', 'subtotal_paisa', 'discount_paisa', 'delivery_paisa', 'total_paisa'];
  const present: string[] = [];

  if (Array.isArray(body.items)) {
    for (const item of body.items) {
      if (item && typeof item === 'object' && 'unit_price_paisa' in item) {
        present.push('items[].unit_price_paisa');
        break;
      }
    }
  }
  for (const field of clientMoneyFields) {
    if (field !== 'unit_price_paisa' && field in body) present.push(field);
  }

  if (present.length === 0) return;

  // Lazy import to avoid pulling the scrubber into every module.
  void (async () => {
    try {
      const { safeLog } = await import('./pii-scrubber');
      safeLog.warn('[checkout] Ignoring client-supplied money fields (server authoritative)', { fields: present.join(', ') });
    } catch {
      // If safeLog is unavailable, fall back to a best-effort non-PII log.
      try { console.warn('[checkout] client money tampering detected (fields omitted)'); } catch {}
    }
  })();

  if (!env) return;

  // Metric for observability. Non-blocking — wrap in try/catch.
  try {
    if (env.ANALYTICS) {
      env.ANALYTICS.writeDataPoint({
        indexes: ['client_money_tampering', context?.ip ?? 'unknown'],
        blobs: present,
        doubles: [1],
      });
    }
  } catch (err) {
    // If even safeLog is unavailable, fall back to a best-effort
    // non-PII log. The data here is structured so no PII leaks.
    void (async () => {
      try {
        const { safeLog } = await import('./pii-scrubber');
        safeLog.warn('[checkout] analytics write failed (non-fatal)', { error: err instanceof Error ? err.message : String(err) });
      } catch {
        // truly nothing left
      }
    })();
  }

  // P1-002 audit fix: atomic tamper counter via D1 ON CONFLICT.
  // The previous KV read-modify-write was racy under concurrency —
  // two requests from the same IP could both read 9 and both write
  // 10, neither seeing the other's increment. The D1 INSERT ... ON
  // CONFLICT DO UPDATE SET count = count + 1 is serialized on the
  // unique (ip, window_id) index. The `RETURNING count` clause
  // gives us the post-increment value, which we compare against
  // the alert threshold (10).
  const ip = context?.ip;
  const db = env?.DB;
  if (!ip || !db) return;
  const windowId = Math.floor(Date.now() / (5 * 60 * 1000));
  const nowStr = context?.now ?? new Date().toISOString().replace('T', ' ').slice(0, 19);
  const ip_ = ip;
  const db_ = db;
  void (async () => {
    try {
      const result = await db_
        .prepare(
          `INSERT INTO tamper_lockout (ip, window_id, count, last_attempt_at, alerted_at)
           VALUES (?1, ?2, 1, ?3, NULL)
           ON CONFLICT (ip, window_id) DO UPDATE SET
             count = count + 1,
             last_attempt_at = excluded.last_attempt_at
           RETURNING count`,
        )
        .bind(ip_, windowId, nowStr)
        .first<{ count: number }>();
      const count = result?.count ?? 0;

      // Alert at the threshold and ONLY if the row was not previously
      // alerted. The `alerted_at IS NULL` guard ensures at most one
      // alert per (ip, window_id) even if 20 concurrent requests
      // race past the threshold. We also bound by `count = 10`
      // exactly so the first request that crosses the threshold is
      // the one that fires the alert.
      if (count === 10) {
        const claimed = await db_
          .prepare(
            `UPDATE tamper_lockout
             SET alerted_at = ?3
             WHERE ip = ?1 AND window_id = ?2 AND alerted_at IS NULL`,
          )
          .bind(ip_, windowId, nowStr)
          .run();
        if (claimed.meta.changes === 1) {
          await db_
            .prepare(
              `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
               VALUES (?1, 'system', ?2, ?3)`,
            )
            .bind(
              crypto.randomUUID(),
              `client_money_tampering_abuse ip=${ip_} fields=${present.join(',')}`,
              nowStr,
            )
            .run();
        }
      }
    } catch (err) {
      try {
        const { safeLog } = await import('./pii-scrubber');
        safeLog.warn('[checkout] tamper counter write failed (non-fatal)', { error: err instanceof Error ? err.message : String(err) });
      } catch {}
    }
  })();
}

const DELIVERY_DEFAULTS = {
  insideDhakaPaisa: 7000,
  outsideDhakaPaisa: 13000
} as const;

/**
 * Compute delivery cost server-side from trusted site settings.
 * The v6.8A migration does not seed shipping rows, so safe integer-paisa
 * defaults are used when settings are absent or invalid.
 *
 * @param shippingZone free-form zone hint; "inside"/"dhaka" maps to inside-Dhaka rate.
 */
export async function calculateDeliveryPaisa(
  db: D1Database,
  shippingZone: string | undefined,
  _subtotalPaisa: Paisa
): Promise<Paisa> {
  const zone = (shippingZone ?? '').toLowerCase();
  const isInsideDhaka = zone.includes('inside') || zone === 'dhaka';
  const settingKey = isInsideDhaka ? 'delivery_inside_dhaka_paisa' : 'delivery_outside_dhaka_paisa';
  const fallback = isInsideDhaka ? DELIVERY_DEFAULTS.insideDhakaPaisa : DELIVERY_DEFAULTS.outsideDhakaPaisa;

  let rate: number = fallback;
  try {
    const row = await db.prepare(`SELECT value FROM site_settings WHERE key = ?1`).bind(settingKey).first<{ value: string }>();
    if (row && row.value !== '') {
      const parsed = Number(row.value);
      if (Number.isSafeInteger(parsed) && parsed >= 0) rate = parsed;
    }
  } catch (err) {
    try { const { safeLog } = await import('./pii-scrubber'); safeLog.warn('[checkout] site_settings delivery lookup failed, using default', { error: err instanceof Error ? err.message : String(err) }); } catch {}
  }

  return assertPaisa(rate, 'delivery_paisa');
}
