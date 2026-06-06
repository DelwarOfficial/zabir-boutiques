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
 * to compute totals; they are display-only hints from the browser. We log a
 * warning so tampering attempts are observable, but we do not reject — the
 * server simply ignores them.
 */
export function assertNoClientMoneyTrust(body: Record<string, unknown>): void {
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

  if (present.length) {
    console.warn('[checkout] Ignoring client-supplied money fields (server authoritative):', present.join(', '));
  }
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
    console.warn('[checkout] site_settings delivery lookup failed, using default:', err);
  }

  return assertPaisa(rate, 'delivery_paisa');
}
