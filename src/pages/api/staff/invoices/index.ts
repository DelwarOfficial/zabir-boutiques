/**
 * POST /api/staff/invoices — Create a POS invoice.
 *
 * RBAC: requires `orders.create` (any sales-tier role). Cashiers
 * (salesman / manager / owner / super_admin) all have it. Packer and
 * support do not.
 *
 * CSRF: enforced by middleware.
 *
 * Idempotency: the request body MUST include `idempotency_key` (any
 * client-generated UUID). A double-submit returns the original
 * invoice with `alreadyProcessed: true` so the cashier UI does not
 * double-post.
 */
export const prerender = false;

import type { APIContext } from "astro";
import { getEnv } from "../../../../lib/env";
import { nowSql } from "../../../../lib/dates";
import { requireAuth, requirePermission, RbacError } from "../../../../lib/rbac";
import { createInvoice } from "../../../../lib/invoices";
import { writeAuditLog, clientIp, userAgent } from "../../../../lib/audit";
import { safeLog } from "../../../../lib/pii-scrubber";
import { normalizeBangladeshPhone } from "../../../../lib/phone";
import { assertPaisa } from "../../../../lib/money";

interface CreateInvoiceRequest {
  idempotency_key?: string;
  customer_name?: string;
  customer_phone?: string;
  items?: Array<{ variant_id?: string; quantity?: number }>;
  payments?: Array<{ method?: string; amount_paisa?: number; reference?: string }>;
  discount_paisa?: number;
  vat_paisa?: number;
  notes?: string;
}

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();

  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, "orders.create");
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  let body: CreateInvoiceRequest;
  try {
    body = (await context.request.json()) as CreateInvoiceRequest;
  } catch {
    return Response.json({ ok: false, code: "INVALID_JSON", message: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.idempotency_key || typeof body.idempotency_key !== "string" || body.idempotency_key.length < 8) {
    return Response.json(
      { ok: false, code: "MISSING_IDEMPOTENCY_KEY", message: "idempotency_key is required (min 8 chars)" },
      { status: 400 },
    );
  }

  // Normalize the customer phone if present. Empty/null is allowed
  // for walk-in customers who don't give a phone number.
  let customerPhone: string | null = null;
  if (body.customer_phone) {
    const phoneResult = normalizeBangladeshPhone(body.customer_phone);
    if (!phoneResult.ok) {
      return Response.json(
        { ok: false, code: "INVALID_PHONE", message: "Use a valid Bangladeshi mobile number." },
        { status: 400 },
      );
    }
    customerPhone = phoneResult.phone;
  }

  // Validate the items array.
  if (!body.items?.length) {
    return Response.json({ ok: false, code: "EMPTY_CART", message: "Cart is empty." }, { status: 400 });
  }
  if (body.items.length > 50) {
    return Response.json({ ok: false, code: "CART_TOO_LARGE", message: "Maximum 50 line items per invoice." }, { status: 400 });
  }
  const items = body.items.map((it) => {
    const variantId = it.variant_id ?? "";
    const quantity = Number(it.quantity);
    if (!variantId || !Number.isSafeInteger(quantity) || quantity < 1) {
      throw new Error("INVALID_QTY");
    }
    return { variantId, quantity };
  });

  // Validate the payments array.
  if (!body.payments?.length) {
    return Response.json({ ok: false, code: "PAYMENT_MISMATCH", message: "At least one payment method is required." }, { status: 400 });
  }
  const validMethods = new Set(["cash", "card", "bkash", "nagad", "rocket", "bank_transfer", "other"]);
  const payments = body.payments.map((p) => {
    if (!p.method || !validMethods.has(p.method)) {
      throw new Error("INVALID_AMOUNT");
    }
    if (!Number.isSafeInteger(p.amount_paisa) || p.amount_paisa < 0) {
      throw new Error("INVALID_AMOUNT");
    }
    return { method: p.method as never, amountPaisa: p.amount_paisa, reference: p.reference ?? null };
  });

  // Discount and VAT are optional. Reject negative values.
  let discountPaisa: number | undefined;
  let vatPaisa: number | undefined;
  try {
    if (body.discount_paisa != null) {
      discountPaisa = assertPaisa(body.discount_paisa, "discount_paisa");
    }
    if (body.vat_paisa != null) {
      vatPaisa = assertPaisa(body.vat_paisa, "vat_paisa");
    }
  } catch {
    return Response.json({ ok: false, code: "INVALID_AMOUNT" }, { status: 400 });
  }

  const result = await createInvoice(
    env,
    {
      idempotencyKey: body.idempotency_key,
      cashierId: user.id,
      customerName: body.customer_name?.trim() || null,
      customerPhone,
      items,
      payments,
      discountPaisa,
      vatPaisa,
      notes: body.notes?.trim() || null,
    },
    now,
  );

  if (!result.ok) {
    const statusMap: Record<string, number> = {
      EMPTY_CART: 400,
      INVALID_QTY: 400,
      INVALID_AMOUNT: 400,
      VARIANT_NOT_FOUND: 404,
      PRICE_MISMATCH: 500,
      OUT_OF_STOCK: 409,
      PAYMENT_MISMATCH: 400,
      DUPLICATE_IDEMPOTENCY: 409,
    };
    return Response.json(
      { ok: false, code: result.code, message: codeMessage(result.code) },
      { status: statusMap[result.code] ?? 500 },
    );
  }

  // Write to the platform-wide audit_log for the tamper-evident
  // chain. Invoice_audit is a per-invoice log; audit_log is the
  // cross-platform chain.
  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: "invoice.create",
    entityType: "invoice",
    entityId: result.invoiceId,
    metadata: {
      receipt_no: result.receiptNo,
      total_paisa: result.totalPaisa,
      amount_paid_paisa: result.amountPaidPaisa,
      change_due_paisa: result.changeDuePaisa,
    },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  }).catch((err) => {
    // Audit failure is non-fatal — the invoice is already created.
    safeLog.warn("[invoices/create] audit log failed (non-fatal)", { error: err instanceof Error ? err.message : String(err) });
  });

  return Response.json(
    {
      ok: true,
      invoice_id: result.invoiceId,
      receipt_no: result.receiptNo,
      total_paisa: result.totalPaisa,
      amount_paid_paisa: result.amountPaidPaisa,
      change_due_paisa: result.changeDuePaisa,
      status: result.status,
      already_processed: result.alreadyProcessed,
    },
    { status: result.alreadyProcessed ? 200 : 201 },
  );
}

function codeMessage(code: string): string {
  switch (code) {
    case "EMPTY_CART":
      return "Cart is empty.";
    case "INVALID_QTY":
      return "One or more items have an invalid quantity.";
    case "INVALID_AMOUNT":
      return "Payment amount is invalid.";
    case "VARIANT_NOT_FOUND":
      return "One item is no longer available.";
    case "PRICE_MISMATCH":
      return "Internal price error. Contact support.";
    case "OUT_OF_STOCK":
      return "One item just went out of stock.";
    case "PAYMENT_MISMATCH":
      return "Payment total is less than the invoice total.";
    case "DUPLICATE_IDEMPOTENCY":
      return "Could not generate a unique receipt number. Retry.";
    default:
      return "Invoice creation failed.";
  }
}
