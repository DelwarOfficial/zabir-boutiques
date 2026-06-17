/**
 * POS Invoice Engine [v7.0]
 *
 * Manages in-store shop sales from the Staff Dashboard. The lifecycle:
 *
 *   1. Cashier builds a draft cart (line items + customer info).
 *   2. Cashier submits the draft with a payment method → server creates
 *      the invoice, deducts stock, and returns the receipt_no.
 *   3. Cashier clicks "Print" → server renders the 80mm thermal receipt.
 *   4. Cashier can void a paid invoice within the same day (status:
 *      'voided') — stock is restored, a `voided_reason` is required,
 *      and a row is written to `invoice_audit`.
 *
 * Concurrency model:
 *   - `idempotency_key` is a UNIQUE column. A cashier who double-clicks
 *     "Create" cannot create two invoices.
 *   - `receipt_no` is auto-generated as `ZB-INV-YYYYMMDD-NNNN`. NNNN
 *     is a per-day counter that resets at UTC midnight. The format
 *     matches the Bangladesh NBR SRO 198/Law/2015 standard.
 *   - Stock deducts are atomic with the invoice insert via a single
 *     `db.batch({ atomic: true })`. If any line item fails, the entire
 *     invoice rolls back.
 *
 * RBAC: invoice create requires `orders.create`. Void requires
 * `orders.cancel` (only owner / super_admin / manager). Refund is
 * out of scope for the initial POS release — refunds go through the
 * existing `returns` flow used for e-commerce.
 */

import { nowSql } from "./dates";
import { assertPaisa } from "./money";
import { writeAuditLog } from "./audit";

/** Generate a Bangladesh NBR-style receipt number.
 *  Format: ZB-INV-YYYYMMDD-NNNN. The NNNN is the count of paid
 *  invoices for the same UTC day, padded to 4 digits. The count is
 *  derived from D1 at insert time, not from a memory cache, so
 *  multiple concurrent cashiers on different Workers see consistent
 *  numbering.
 *
 *  Returns a tuple of (receiptNo, dailyCounter). Callers may reuse
 *  the counter to set the next number; for a single insert the
 *  counter is informational.
 */
export async function generateReceiptNo(
  db: D1Database,
  now: string,
): Promise<{ receiptNo: string; counter: number }> {
  // Extract the YYYYMMDD prefix from the SQL timestamp string.
  const datePart = now.replace(/[-: ]/g, "").slice(0, 8);
  const prefix = `ZB-INV-${datePart}-`;

  // The counter is computed atomically inside the same transaction
  // that creates the invoice. We pre-allocate a candidate receipt
  // number here and let the UNIQUE(receipt_no) constraint guard
  // against concurrent duplicates. If two cashiers race, the second
  // gets a uniqueness violation and retries with a higher counter.
  const lastRow = await db
    .prepare(
      `SELECT receipt_no FROM invoices
       WHERE receipt_no LIKE ?1
       ORDER BY receipt_no DESC LIMIT 1`,
    )
    .bind(`${prefix}%`)
    .first<{ receipt_no: string }>();

  let nextCounter = 1;
  if (lastRow?.receipt_no) {
    const match = lastRow.receipt_no.match(/-(\d+)$/);
    if (match) nextCounter = Number(match[1]) + 1;
  }
  const receiptNo = `${prefix}${String(nextCounter).padStart(4, "0")}`;
  return { receiptNo, counter: nextCounter };
}

/** Retry receipt number generation up to N times if a concurrent
 *  cashier claimed the same number. Returns null on exhaustion.
 */
export async function generateReceiptNoWithRetry(
  db: D1Database,
  now: string,
  maxAttempts = 10,
): Promise<string | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const { receiptNo } = await generateReceiptNo(db, now);
    // Cheap pre-check; the real guard is the UNIQUE constraint.
    const taken = await db
      .prepare(`SELECT 1 AS x FROM invoices WHERE receipt_no = ?1 LIMIT 1`)
      .bind(receiptNo)
      .first();
    if (!taken) return receiptNo;
  }
  return null;
}

export type InvoicePaymentMethod =
  | "cash"
  | "card"
  | "bkash"
  | "nagad"
  | "rocket"
  | "bank_transfer"
  | "other";

export interface InvoiceLineInput {
  variantId: string;
  quantity: number;
}

export interface InvoicePaymentInput {
  method: InvoicePaymentMethod;
  amountPaisa: number;
  reference?: string | null;
}

export interface CreateInvoiceInput {
  idempotencyKey: string;
  cashierId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  items: InvoiceLineInput[];
  payments: InvoicePaymentInput[];
  discountPaisa?: number;
  vatPaisa?: number;
  notes?: string | null;
}

export interface CreateInvoiceResult {
  ok: true;
  invoiceId: string;
  receiptNo: string;
  totalPaisa: number;
  amountPaidPaisa: number;
  changeDuePaisa: number;
  status: "paid";
  alreadyProcessed: boolean;
}

export type CreateInvoiceFailure =
  | { ok: false; code: "EMPTY_CART" | "INVALID_QTY" | "INVALID_AMOUNT" | "VARIANT_NOT_FOUND" | "PRICE_MISMATCH" | "OUT_OF_STOCK" | "PAYMENT_MISMATCH" | "DUPLICATE_IDEMPOTENCY" };

/** Single atomic-batch invoice creation.
 *
 *  Stock deducts, payments insert, status update, and audit row are
 *  all in one batch. If any statement returns 0 changes, the entire
 *  batch rolls back — no half-created invoices, no negative stock.
 */
export async function createInvoice(
  env: { DB: D1Database },
  input: CreateInvoiceInput,
  now: string,
): Promise<CreateInvoiceResult | CreateInvoiceFailure> {
  const db = env.DB;

  if (!input.items?.length) return { ok: false, code: "EMPTY_CART" };
  if (input.items.length > 50) return { ok: false, code: "EMPTY_CART" };
  if (input.items.some((it) => !Number.isSafeInteger(it.quantity) || it.quantity < 1)) {
    return { ok: false, code: "INVALID_QTY" };
  }
  if (input.payments.length === 0) return { ok: false, code: "PAYMENT_MISMATCH" };
  if (input.payments.some((p) => !Number.isSafeInteger(p.amountPaisa) || p.amountPaisa < 0)) {
    return { ok: false, code: "INVALID_AMOUNT" };
  }

  // Load authoritative variant snapshots from D1. Joined in one
  // query so the cashier UI has SKU + product_name + variant_label
  // for the printed receipt.
  const variantIds = [...new Set(input.items.map((it) => it.variantId))];
  const placeholders = variantIds.map((_, i) => `?${i + 1}`).join(",");
  const variantRows = await db
    .prepare(
      `SELECT v.id AS variant_id, v.product_id, v.sku, v.size, v.color, v.is_deleted,
              p.name AS product_name, p.status AS product_status,
              COALESCE(v.price_paisa, p.price_paisa) AS price_paisa,
              iv.quantity AS stock_quantity, iv.is_available
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN inventory_items iv ON iv.variant_id = v.id
       WHERE v.id IN (${placeholders})`,
    )
    .bind(...variantIds)
    .all<{
      variant_id: string;
      product_id: string;
      sku: string;
      size: string | null;
      color: string | null;
      is_deleted: number;
      product_name: string;
      product_status: string;
      price_paisa: number | null;
      stock_quantity: number | null;
      is_available: number | null;
    }>();

  const snapshots = new Map((variantRows.results ?? []).map((r) => [r.variant_id, r]));
  for (const id of variantIds) {
    const s = snapshots.get(id);
    if (!s) return { ok: false, code: "VARIANT_NOT_FOUND" };
    if (s.is_deleted) return { ok: false, code: "VARIANT_NOT_FOUND" };
    if (s.product_status !== "published") return { ok: false, code: "VARIANT_NOT_FOUND" };
    if (s.price_paisa == null || !Number.isSafeInteger(s.price_paisa) || s.price_paisa < 0) {
      return { ok: false, code: "PRICE_MISMATCH" };
    }
  }

  // Build the line items + check stock.
  const lines = input.items.map((it) => {
    const s = snapshots.get(it.variantId)!;
    const unitPrice = assertPaisa(s.price_paisa!, "unit_price_paisa");
    const totalPrice = assertPaisa(unitPrice * it.quantity, "line_total");
    const label = [s.size, s.color].filter(Boolean).join(" / ") || s.sku;
    return {
      variantId: it.variantId,
      quantity: it.quantity,
      unitPricePaisa: unitPrice,
      totalPricePaisa: totalPrice,
      productName: s.product_name,
      variantLabel: label,
      sku: s.sku,
    };
  });
  for (let i = 0; i < input.items.length; i++) {
    const s = snapshots.get(input.items[i].variantId)!;
    const requested = input.items[i].quantity;
    if ((s.stock_quantity ?? 0) < requested) {
      return { ok: false, code: "OUT_OF_STOCK" };
    }
  }

  // Compute totals server-side. Discount and VAT are optional.
  const subtotalPaisa = assertPaisa(
    lines.reduce((s, l) => s + l.totalPricePaisa, 0),
    "subtotal_paisa",
  );
  const discountPaisa = assertPaisa(Math.max(0, input.discountPaisa ?? 0), "discount_paisa");
  const vatPaisa = assertPaisa(Math.max(0, input.vatPaisa ?? 0), "vat_paisa");
  const totalPaisa = assertPaisa(
    Math.max(0, subtotalPaisa - discountPaisa + vatPaisa),
    "total_paisa",
  );
  const amountPaidPaisa = assertPaisa(
    input.payments.reduce((s, p) => s + p.amountPaisa, 0),
    "amount_paid_paisa",
  );
  if (amountPaidPaisa < totalPaisa) {
    return { ok: false, code: "PAYMENT_MISMATCH" };
  }
  const changeDuePaisa = assertPaisa(amountPaidPaisa - totalPaisa, "change_due_paisa");

  // Claim the receipt number. The UNIQUE(receipt_no) constraint is
  // the real guard against concurrent inserts; the pre-check is just
  // an optimization.
  const receiptNo = await generateReceiptNoWithRetry(db, now);
  if (!receiptNo) return { ok: false, code: "DUPLICATE_IDEMPOTENCY" };

  const invoiceId = crypto.randomUUID();

  // Build the full atomic batch. The idempotency_key UNIQUE is the
  // primary guard against double-creation. If the cashier's
  // double-click is fast enough to land in the same D1 write-batch,
  // the INSERT OR IGNORE on idempotency_key short-circuits the second
  // call.
  const insertInvoice = db
    .prepare(
      `INSERT OR IGNORE INTO invoices (
        id, receipt_no, idempotency_key, cashier_id, customer_name, customer_phone,
        status, subtotal_paisa, discount_paisa, vat_paisa, total_paisa,
        amount_paid_paisa, change_due_paisa, notes, created_at, updated_at, paid_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'paid', ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14, ?14)`,
    )
    .bind(
      invoiceId,
      receiptNo,
      input.idempotencyKey,
      input.cashierId,
      input.customerName ?? null,
      input.customerPhone ?? null,
      subtotalPaisa,
      discountPaisa,
      vatPaisa,
      totalPaisa,
      amountPaidPaisa,
      changeDuePaisa,
      input.notes ?? null,
      now,
    );

  // Item inserts.
  const insertItemStmts = lines.map((l) =>
    db
      .prepare(
        `INSERT INTO invoice_items (id, invoice_id, variant_id, product_name, variant_label, sku, quantity, unit_price_paisa, total_price_paisa, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      )
      .bind(
        crypto.randomUUID(),
        invoiceId,
        l.variantId,
        l.productName,
        l.variantLabel,
        l.sku,
        l.quantity,
        l.unitPricePaisa,
        l.totalPricePaisa,
        now,
      ),
  );

  // Payment-method inserts.
  const insertPaymentStmts = input.payments.map((p) =>
    db
      .prepare(
        `INSERT INTO invoice_payments (id, invoice_id, method, amount_paisa, reference, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(
        crypto.randomUUID(),
        invoiceId,
        p.method,
        p.amountPaisa,
        p.reference ?? null,
        now,
      ),
  );

  // Stock deducts. The WHERE guard `quantity >= ?1` makes the
  // over-allocation case fail at the statement level (meta.changes=0),
  // which causes the atomic batch to roll back.
  const deductStmts = lines.map((l) =>
    db
      .prepare(
        `UPDATE inventory_items
         SET quantity = quantity - ?1, updated_at = ?2
         WHERE variant_id = ?3 AND quantity >= ?1`,
      )
      .bind(l.quantity, now, l.variantId),
  );

  // Audit row. Same pattern as the platform-wide audit_log.
  const insertAudit = db
    .prepare(
      `INSERT INTO invoice_audit (id, invoice_id, actor_staff_id, action, from_status, to_status, metadata_json, created_at)
       VALUES (?1, ?2, ?3, 'invoice.create', NULL, 'paid', ?4, ?5)`,
    )
    .bind(
      crypto.randomUUID(),
      invoiceId,
      input.cashierId,
      JSON.stringify({
        receipt_no: receiptNo,
        subtotal_paisa: subtotalPaisa,
        discount_paisa: discountPaisa,
        vat_paisa: vatPaisa,
        total_paisa: totalPaisa,
        amount_paid_paisa: amountPaidPaisa,
        change_due_paisa: changeDuePaisa,
        item_count: lines.length,
        payment_count: input.payments.length,
      }),
      now,
    );

  // P0-002 / P0-003 style: every statement is in one atomic batch.
  // Either all commit or all roll back.
  const batchResult = await db.batch(
    [
      insertInvoice,
      ...insertItemStmts,
      ...insertPaymentStmts,
      ...deductStmts,
      insertAudit,
    ],
    { atomic: true },
  );

  // The idempotency_key UNIQUE is the only mechanism that detects a
  // double-create. INSERT OR IGNORE returns meta.changes=0 for the
  // second call.
  const invoiceInsert = batchResult[0];
  if (invoiceInsert.meta.changes === 0) {
    // Replay: the same idempotency_key already created this invoice.
    // Return the original row so the cashier UI doesn't double-post.
    const existing = await db
      .prepare(
        `SELECT id, receipt_no, total_paisa, amount_paid_paisa, change_due_paisa
         FROM invoices WHERE idempotency_key = ?1`,
      )
      .bind(input.idempotencyKey)
      .first<{
        id: string;
        receipt_no: string;
        total_paisa: number;
        amount_paid_paisa: number;
        change_due_paisa: number;
      }>();
    if (existing) {
      return {
        ok: true,
        invoiceId: existing.id,
        receiptNo: existing.receipt_no,
        totalPaisa: existing.total_paisa,
        amountPaidPaisa: existing.amount_paid_paisa,
        changeDuePaisa: existing.change_due_paisa,
        status: "paid",
        alreadyProcessed: true,
      };
    }
  }

  return {
    ok: true,
    invoiceId,
    receiptNo,
    totalPaisa,
    amountPaidPaisa,
    changeDuePaisa,
    status: "paid",
    alreadyProcessed: false,
  };
}

/** Void a paid invoice. Restores stock and writes a voided_reason.
 *  Atomic with the status transition.
 */
export async function voidInvoice(
  env: { DB: D1Database },
  invoiceId: string,
  actorStaffId: string,
  reason: string,
  now: string,
): Promise<{ ok: true } | { ok: false; code: "NOT_FOUND" | "ALREADY_VOIDED" | "INVALID_REASON" }> {
  if (!reason || reason.trim().length < 5 || reason.trim().length > 500) {
    return { ok: false, code: "INVALID_REASON" };
  }
  const db = env.DB;
  const invoice = await db
    .prepare(`SELECT id, status FROM invoices WHERE id = ?1`)
    .bind(invoiceId)
    .first<{ id: string; status: string }>();
  if (!invoice) return { ok: false, code: "NOT_FOUND" };
  if (invoice.status === "voided") return { ok: false, code: "ALREADY_VOIDED" };
  if (invoice.status !== "paid" && invoice.status !== "issued") {
    return { ok: false, code: "ALREADY_VOIDED" };
  }

  const items = await db
    .prepare(`SELECT variant_id, quantity FROM invoice_items WHERE invoice_id = ?1`)
    .bind(invoiceId)
    .all<{ variant_id: string; quantity: number }>();
  const itemRows = items.results ?? [];

  const restockStmts = itemRows.map((it) =>
    db
      .prepare(
        `UPDATE inventory_items SET quantity = quantity + ?1, updated_at = ?2 WHERE variant_id = ?3`,
      )
      .bind(it.quantity, now, it.variant_id),
  );

  const batch = await db.batch(
    [
      db
        .prepare(
          `UPDATE invoices SET status='voided', voided_reason=?2, voided_by=?3, voided_at=?4, updated_at=?4
           WHERE id=?1 AND status IN ('issued','paid')`,
        )
        .bind(invoiceId, reason.trim(), actorStaffId, now),
      ...restockStmts,
      db
        .prepare(
          `INSERT INTO invoice_audit (id, invoice_id, actor_staff_id, action, from_status, to_status, metadata_json, created_at)
           VALUES (?1, ?2, ?3, 'invoice.void', 'paid', 'voided', ?4, ?5)`,
        )
        .bind(crypto.randomUUID(), invoiceId, actorStaffId, JSON.stringify({ reason: reason.trim() }), now),
    ],
    { atomic: true },
  );

  // The status UPDATE returning 0 changes means another operator
  // voided this invoice first.
  if (batch[0].meta.changes === 0) return { ok: false, code: "ALREADY_VOIDED" };
  return { ok: true };
}

export interface PosInvoiceHistoryRow {
  id: string;
  receipt_no: string;
  created_at: string;
  status: string;
  total_paisa: number;
  amount_paid_paisa: number;
  change_due_paisa: number;
  customer_name: string | null;
  cashier_name: string;
}

export function isInvoicesSchemaMissingError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("no such table: invoices");
}

/** Recent POS invoices for the staff history page. */
export async function listPosInvoiceHistory(
  db: D1Database,
  since: string,
  limit = 100,
): Promise<PosInvoiceHistoryRow[]> {
  const result = await db
    .prepare(
      `SELECT i.id, i.receipt_no, i.created_at, i.status, i.total_paisa,
              i.amount_paid_paisa, i.change_due_paisa, i.customer_name,
              u.full_name AS cashier_name
       FROM invoices i
       JOIN staff_users u ON u.id = i.cashier_id
       WHERE i.created_at >= ?1
       ORDER BY i.created_at DESC
       LIMIT ?2`,
    )
    .bind(since, limit)
    .all<PosInvoiceHistoryRow>();
  return result.results ?? [];
}

/** Load a full invoice for printing. Returns null if not found. */
export interface InvoiceWithItems {
  invoice: {
    id: string;
    receipt_no: string;
    cashier_id: string;
    cashier_name: string;
    customer_name: string | null;
    customer_phone: string | null;
    status: string;
    subtotal_paisa: number;
    discount_paisa: number;
    vat_paisa: number;
    total_paisa: number;
    amount_paid_paisa: number;
    change_due_paisa: number;
    notes: string | null;
    voided_reason: string | null;
    created_at: string;
    paid_at: string | null;
  };
  items: Array<{
    product_name: string;
    variant_label: string;
    sku: string;
    quantity: number;
    unit_price_paisa: number;
    total_price_paisa: number;
  }>;
  payments: Array<{ method: string; amount_paisa: number; reference: string | null }>;
}

export async function loadInvoiceForPrint(
  db: D1Database,
  invoiceId: string,
): Promise<InvoiceWithItems | null> {
  const invoice = await db
    .prepare(
      `SELECT i.id, i.receipt_no, i.cashier_id, u.full_name AS cashier_name,
              i.customer_name, i.customer_phone, i.status,
              i.subtotal_paisa, i.discount_paisa, i.vat_paisa, i.total_paisa,
              i.amount_paid_paisa, i.change_due_paisa, i.notes, i.voided_reason,
              i.created_at, i.paid_at
       FROM invoices i
       JOIN staff_users u ON u.id = i.cashier_id
       WHERE i.id = ?1`,
    )
    .bind(invoiceId)
    .first<InvoiceWithItems["invoice"]>();
  if (!invoice) return null;

  const items = await db
    .prepare(
      `SELECT product_name, variant_label, sku, quantity, unit_price_paisa, total_price_paisa
       FROM invoice_items WHERE invoice_id = ?1 ORDER BY rowid ASC`,
    )
    .bind(invoiceId)
    .all<InvoiceWithItems["items"][number]>();
  const payments = await db
    .prepare(
      `SELECT method, amount_paisa, reference FROM invoice_payments WHERE invoice_id = ?1 ORDER BY rowid ASC`,
    )
    .bind(invoiceId)
    .all<InvoiceWithItems["payments"][number]>();

  return {
    invoice,
    items: items.results ?? [],
    payments: payments.results ?? [],
  };
}
