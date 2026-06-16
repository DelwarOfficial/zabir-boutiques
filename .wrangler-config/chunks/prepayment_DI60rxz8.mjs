globalThis.process ??= {};
globalThis.process.env ??= {};
import { m as multiplyPaisa, d as addPaisa, a as assertPaisa } from "./money_DWLDQpFs.mjs";
function assertValidPaymentMethod(method) {
  if (!VALID_PAYMENT_METHODS.includes(method)) {
    throw new Error(`Invalid payment_method: ${method}. Must be one of: ${VALID_PAYMENT_METHODS.join(", ")}`);
  }
}
function generateOrderNumber() {
  const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replace(/-/g, "");
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `ZB-${date}-${hex}`;
}
const VALID_PAYMENT_METHODS = ["cod", "uddoktapay", "partial_prepay", "in_store"];
function reservationExpiresAt(now) {
  const iso = `${now.replace(" ", "T")}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid SQL timestamp for reservation expiry");
  date.setMinutes(date.getMinutes() + 10);
  return date.toISOString().replace("T", " ").slice(0, 19);
}
function variantLabel(snapshot) {
  const parts = [snapshot.size, snapshot.color].filter(Boolean);
  return parts.length ? parts.join(" / ") : snapshot.sku;
}
async function loadVariantSnapshots$1(db, variantIds) {
  const uniqueIds = [...new Set(variantIds)];
  if (uniqueIds.length === 0) return /* @__PURE__ */ new Map();
  const placeholders = uniqueIds.map((_, index) => `?${index + 1}`).join(", ");
  const rows = await db.prepare(
    `SELECT v.id AS variant_id, p.name AS product_name, v.size, v.color, v.sku
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     WHERE v.id IN (${placeholders})
       AND v.is_deleted = 0
       AND p.status = 'published'`
  ).bind(...uniqueIds).all();
  return new Map((rows.results ?? []).map((row) => [row.variant_id, row]));
}
async function insertReservedOrderWithRetry(db, orderData, items, now, maxAttempts = 3) {
  assertValidPaymentMethod(orderData.payment_method);
  const snapshots = await loadVariantSnapshots$1(db, items.map((item) => item.variantId));
  const missing = items.find((item) => !snapshots.has(item.variantId));
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
      orderId,
      orderNumber,
      orderData.phone,
      orderData.name,
      orderData.address,
      orderData.note ?? null,
      orderData.shipping_zone ?? null,
      orderData.subtotal_paisa,
      orderData.delivery_paisa,
      orderData.discount_paisa,
      orderData.total_paisa,
      orderData.payment_method,
      orderData.fraud_decision,
      orderData.status ?? "pending_review",
      now
    );
    const orderItemStmts = items.map((item) => {
      const snapshot = snapshots.get(item.variantId);
      return db.prepare(
        `INSERT INTO order_items (
          id, order_id, variant_id, product_name, variant_label,
          quantity, unit_price_paisa, total_price_paisa, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
      ).bind(
        crypto.randomUUID(),
        orderId,
        item.variantId,
        snapshot.product_name,
        variantLabel(snapshot),
        item.quantity,
        item.unitPricePaisa,
        item.unitPricePaisa * item.quantity,
        now
      );
    });
    const reservationStmts = items.map(
      (item) => db.prepare(
        `INSERT INTO stock_reservations (
          id, order_id, variant_id, quantity, status, expires_at, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6, ?6)`
      ).bind(crypto.randomUUID(), orderId, item.variantId, item.quantity, expiresAt, now)
    );
    try {
      await db.batch([orderStmt, ...orderItemStmts, ...reservationStmts], { atomic: true });
      return { orderId, orderNumber };
    } catch (err) {
      const collision = err instanceof Error && err.message.includes("UNIQUE constraint failed: orders.order_number");
      if (!collision || attempt === maxAttempts - 1) throw err;
    }
  }
  throw new Error("Failed to generate unique order number after max attempts");
}
const MAX_CART_ITEMS = 10;
async function loadVariantSnapshots(db, items) {
  const uniqueIds = [...new Set(items.map((item) => item.variantId).filter(Boolean))];
  if (uniqueIds.length === 0 || uniqueIds.length > MAX_CART_ITEMS) {
    throw new Error("INVALID_CART_SIZE");
  }
  const placeholders = uniqueIds.map((_, index) => `?${index + 1}`).join(", ");
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
  ).bind(...uniqueIds).all();
  const snapshots = /* @__PURE__ */ new Map();
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
function calculateAuthoritativeSubtotal(items, snapshots) {
  const lineTotals = items.map((item) => {
    const snapshot = snapshots.get(item.variantId);
    if (!snapshot) throw new Error(`VARIANT_NOT_FOUND:${item.variantId}`);
    if (!Number.isSafeInteger(item.qty) || item.qty < 1) throw new Error("INVALID_QTY");
    return multiplyPaisa(snapshot.price_paisa, item.qty);
  });
  return addPaisa(lineTotals);
}
function assertNoClientMoneyTrust(body) {
  const clientMoneyFields = ["unit_price_paisa", "subtotal_paisa", "discount_paisa", "delivery_paisa", "total_paisa"];
  const present = [];
  if (Array.isArray(body.items)) {
    for (const item of body.items) {
      if (item && typeof item === "object" && "unit_price_paisa" in item) {
        present.push("items[].unit_price_paisa");
        break;
      }
    }
  }
  for (const field of clientMoneyFields) {
    if (field !== "unit_price_paisa" && field in body) present.push(field);
  }
  if (present.length) {
    console.warn("[checkout] Ignoring client-supplied money fields (server authoritative):", present.join(", "));
  }
}
const DELIVERY_DEFAULTS = {
  insideDhakaPaisa: 7e3,
  outsideDhakaPaisa: 13e3
};
async function calculateDeliveryPaisa(db, shippingZone, _subtotalPaisa) {
  const zone = (shippingZone ?? "").toLowerCase();
  const isInsideDhaka = zone.includes("inside") || zone === "dhaka";
  const settingKey = isInsideDhaka ? "delivery_inside_dhaka_paisa" : "delivery_outside_dhaka_paisa";
  const fallback = isInsideDhaka ? DELIVERY_DEFAULTS.insideDhakaPaisa : DELIVERY_DEFAULTS.outsideDhakaPaisa;
  let rate = fallback;
  try {
    const row = await db.prepare(`SELECT value FROM site_settings WHERE key = ?1`).bind(settingKey).first();
    if (row && row.value !== "") {
      const parsed = Number(row.value);
      if (Number.isSafeInteger(parsed) && parsed >= 0) rate = parsed;
    }
  } catch (err) {
    console.warn("[checkout] site_settings delivery lookup failed, using default:", err);
  }
  return assertPaisa(rate, "delivery_paisa");
}
const PREPAYMENT_ITEM_THRESHOLD = 2;
const PREPAYMENT_MESSAGE = "Orders containing more than two items require a 50% advance payment to confirm the order. The remaining amount can be paid to the delivery person when receiving the parcel.";
function calculatePrepayment(distinctItemCount, totalPaisa, paymentMethod) {
  if (paymentMethod === "in_store") {
    return { required: false, advancePaisa: 0, balancePaisa: 0, message: null };
  }
  if (paymentMethod === "uddoktapay") {
    return { required: false, advancePaisa: totalPaisa, balancePaisa: 0, message: null };
  }
  if (paymentMethod === "partial_prepay") {
    const advancePaisa2 = totalPaisa + 1 >> 1;
    const balancePaisa2 = totalPaisa - advancePaisa2;
    return { required: false, advancePaisa: advancePaisa2, balancePaisa: balancePaisa2, message: null };
  }
  if (distinctItemCount <= PREPAYMENT_ITEM_THRESHOLD) {
    return { required: false, advancePaisa: 0, balancePaisa: totalPaisa, message: null };
  }
  const advancePaisa = totalPaisa + 1 >> 1;
  const balancePaisa = totalPaisa - advancePaisa;
  return {
    required: true,
    advancePaisa,
    balancePaisa,
    message: PREPAYMENT_MESSAGE
  };
}
export {
  calculateDeliveryPaisa as a,
  calculatePrepayment as b,
  calculateAuthoritativeSubtotal as c,
  assertNoClientMoneyTrust as d,
  insertReservedOrderWithRetry as i,
  loadVariantSnapshots as l
};
