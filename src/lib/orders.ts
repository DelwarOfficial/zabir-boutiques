/**
 * Order Number Format [v6.8A]
 * Format: ZB-YYYYMMDD-XXXXXX (6 hex chars from 3 random bytes)
 */

export function generateOrderNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `ZB-${date}-${hex}`;
}

type OrderInsertData = {
  phone: string;
  name: string;
  address: string;
  shipping_zone?: string;
  note?: string;
  subtotal_paisa: number;
  delivery_paisa: number;
  discount_paisa: number;
  total_paisa: number;
  payment_method: 'cod' | 'uddoktapay';
  fraud_decision: string;
  status?: string;
};

export type ReservedOrderItem = {
  variantId: string;
  quantity: number;
  unitPricePaisa: number;
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
  date.setMinutes(date.getMinutes() + 30);
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
  const rows = await db.prepare(
    `SELECT v.id AS variant_id, p.name AS product_name, v.size, v.color, v.sku
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     WHERE v.id IN (${placeholders}) AND v.is_deleted = 0`
  ).bind(...uniqueIds).all<VariantSnapshot>();

  return new Map((rows.results ?? []).map(row => [row.variant_id, row]));
}

export async function insertOrderWithRetry(
  db: D1Database,
  orderData: OrderInsertData,
  now: string,
  maxAttempts = 3
): Promise<{ orderId: string; orderNumber: string }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const orderId = crypto.randomUUID();
    const orderNumber = generateOrderNumber();
    try {
      await db.prepare(
        `INSERT INTO orders (
          id, order_number, phone, name, address, note,
          subtotal_paisa, delivery_paisa, discount_paisa, total_paisa,
          payment_method, fraud_decision, status, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)`
      ).bind(
        orderId, orderNumber, orderData.phone, orderData.name, orderData.address,
        orderData.note ?? null, orderData.subtotal_paisa, orderData.delivery_paisa,
        orderData.discount_paisa, orderData.total_paisa, orderData.payment_method,
        orderData.fraud_decision, orderData.status ?? 'pending_review', now
      ).run();
      return { orderId, orderNumber };
    } catch (err) {
      const collision = err instanceof Error && err.message.includes('UNIQUE constraint failed: orders.order_number');
      if (!collision || attempt === maxAttempts - 1) throw err;
    }
  }
  throw new Error('Failed to generate unique order number after max attempts');
}

export async function insertReservedOrderWithRetry(
  db: D1Database,
  orderData: OrderInsertData,
  items: ReservedOrderItem[],
  now: string,
  maxAttempts = 3
): Promise<{ orderId: string; orderNumber: string }> {
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
        subtotal_paisa, delivery_paisa, discount_paisa, total_paisa,
        payment_method, fraud_decision, status, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)`
    ).bind(
      orderId, orderNumber, orderData.phone, orderData.name, orderData.address,
      orderData.note ?? null, orderData.shipping_zone ?? null,
      orderData.subtotal_paisa, orderData.delivery_paisa,
      orderData.discount_paisa, orderData.total_paisa, orderData.payment_method,
      orderData.fraud_decision, orderData.status ?? 'pending_review', now
    );

    const orderItemStmts = items.map(item => {
      const snapshot = snapshots.get(item.variantId)!;
      return db.prepare(
        `INSERT INTO order_items (
          id, order_id, variant_id, product_name, variant_label,
          quantity, unit_price_paisa, total_price_paisa, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
      ).bind(
        crypto.randomUUID(), orderId, item.variantId, snapshot.product_name,
        variantLabel(snapshot), item.quantity, item.unitPricePaisa,
        item.unitPricePaisa * item.quantity, now
      );
    });

    const reservationStmts = items.map(item =>
      db.prepare(
        `INSERT INTO stock_reservations (
          id, order_id, variant_id, quantity, status, expires_at, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6, ?6)`
      ).bind(crypto.randomUUID(), orderId, item.variantId, item.quantity, expiresAt, now)
    );

    try {
      await db.batch([orderStmt, ...orderItemStmts, ...reservationStmts]);
      return { orderId, orderNumber };
    } catch (err) {
      const collision = err instanceof Error && err.message.includes('UNIQUE constraint failed: orders.order_number');
      if (!collision || attempt === maxAttempts - 1) throw err;
    }
  }

  throw new Error('Failed to generate unique order number after max attempts');
}
