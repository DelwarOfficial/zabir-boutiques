/**
 * Order Number Format [v6.8A]
 * Format: ZB-YYYYMMDD-XXXXXX (6 hex chars from 3 random bytes)
 */

function assertValidPaymentMethod(method: string): void {
  if (!VALID_PAYMENT_METHODS.includes(method as never)) {
    throw new Error(`Invalid payment_method: ${method}. Must be one of: ${VALID_PAYMENT_METHODS.join(', ')}`);
  }
}

export function generateOrderNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `ZB-${date}-${hex}`;
}

export const VALID_PAYMENT_METHODS = ['cod', 'uddoktapay', 'partial_prepay', 'in_store'] as const;

type OrderInsertData = {
  phone: string;
  name: string;
  address: string;
  shipping_zone?: string;
  note?: string;
  subtotal_paisa: number;
  delivery_paisa: number;
  discount_paisa: number;
  vat_paisa?: number;
  total_paisa: number;
  payment_method: 'cod' | 'uddoktapay' | 'partial_prepay' | 'in_store';
  fraud_decision: string;
  status?: string;
};

export type ReservedOrderItem = {
  variantId: string;
  quantity: number;
  unitPricePaisa: number;
  vatPaisa?: number;
  reservationId?: string;
};

type VariantSnapshot = {
  variant_id: string;
  product_name: string;
  size: string | null;
  color: string | null;
  sku: string;
};

function reservationExpiresAt(now: string): string {
  const iso = `${now.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid SQL timestamp for reservation expiry');
  // Master_Prompt v7.0 §6.3: 10-minute reservation TTL (was 30 min in v6.8D).
  date.setMinutes(date.getMinutes() + 10);
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function variantLabel(snapshot: VariantSnapshot): string {
  const parts = [snapshot.size, snapshot.color].filter(Boolean);
  return parts.length ? parts.join(' / ') : snapshot.sku;
}

async function loadVariantSnapshots(db: D1Database, variantIds: string[]): Promise<Map<string, VariantSnapshot>> {
  const uniqueIds = [...new Set(variantIds)];
  if (uniqueIds.length === 0) return new Map();

  const placeholders = uniqueIds.map((_, index) => `?${index + 1}`).join(', ');
  // Same filtering contract as checkout-pricing.loadVariantSnapshots:
  //   variant must not be soft-deleted AND product must be published.
  // This guarantees a guest-priced cart cannot be persisted with reference
  // to a draft/archived product or a deleted variant.
  const rows = await db.prepare(
    `SELECT v.id AS variant_id, p.name AS product_name, v.size, v.color, v.sku
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     WHERE v.id IN (${placeholders})
       AND v.is_deleted = 0
       AND p.status = 'published'`
  ).bind(...uniqueIds).all<VariantSnapshot>();

  return new Map((rows.results ?? []).map(row => [row.variant_id, row]));
}

export async function insertReservedOrderWithRetry(
  db: D1Database,
  orderData: OrderInsertData,
  items: ReservedOrderItem[],
  now: string,
  maxAttempts = 3
): Promise<{ orderId: string; orderNumber: string }> {
  assertValidPaymentMethod(orderData.payment_method);
  const snapshots = await loadVariantSnapshots(db, items.map(item => item.variantId));
  const missing = items.find(item => !snapshots.has(item.variantId));
  if (missing) throw new Error(`Missing variant snapshot for ${missing.variantId}`);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const orderId = crypto.randomUUID();
    const orderNumber = generateOrderNumber();
    const expiresAt = reservationExpiresAt(now);

    const orderStmt = db.prepare(
      `INSERT INTO orders (
        id, order_number, phone, name, address, note, shipping_zone,
        subtotal_paisa, delivery_paisa, discount_paisa, vat_paisa, total_paisa,
        payment_method, fraud_decision, status, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16)`
    ).bind(
      orderId, orderNumber, orderData.phone, orderData.name, orderData.address,
      orderData.note ?? null, orderData.shipping_zone ?? null,
      orderData.subtotal_paisa, orderData.delivery_paisa,
      orderData.discount_paisa, orderData.vat_paisa ?? 0, orderData.total_paisa, orderData.payment_method,
      orderData.fraud_decision, orderData.status ?? 'pending_review', now
    );

    const orderItemStmts = items.map(item => {
      const snapshot = snapshots.get(item.variantId)!;
      return db.prepare(
        `INSERT INTO order_items (
          id, order_id, variant_id, product_name, variant_label,
          quantity, unit_price_paisa, total_price_paisa, vat_paisa, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
      ).bind(
        crypto.randomUUID(), orderId, item.variantId, snapshot.product_name,
        variantLabel(snapshot), item.quantity, item.unitPricePaisa,
        item.unitPricePaisa * item.quantity, item.vatPaisa ?? 0, now
      );
    });

    const reservationStmts = items.map((item) => {
      item.reservationId ??= crypto.randomUUID();
      return db.prepare(
        `INSERT INTO stock_reservations (
          id, order_id, variant_id, quantity, status, expires_at, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6, ?6)`
      ).bind(item.reservationId, orderId, item.variantId, item.quantity, expiresAt, now);
    });

    try {
      // atomic:true so an order row, its order_items, and its stock_reservations
      // are committed as a single D1 transaction. If any statement fails, the
      // whole batch rolls back — no half-created orders.
      await db.batch([orderStmt, ...orderItemStmts, ...reservationStmts], { atomic: true });
      return { orderId, orderNumber };
    } catch (err) {
      const collision = err instanceof Error && err.message.includes('UNIQUE constraint failed: orders.order_number');
      if (!collision || attempt === maxAttempts - 1) throw err;
    }
  }

  throw new Error('Failed to generate unique order number after max attempts');
}
