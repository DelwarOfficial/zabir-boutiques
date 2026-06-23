import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const invoices = sqliteTable('invoices', {
  id: text('id').primaryKey(),
  receiptNo: text('receipt_no').notNull().unique(),
  idempotencyKey: text('idempotency_key').unique(),
  cashierId: text('cashier_id').notNull(),
  customerName: text('customer_name'),
  customerPhone: text('customer_phone'),
  status: text('status', { enum: ['draft', 'issued', 'paid', 'voided', 'refunded'] }).notNull().default('draft'),
  subtotalPaisa: integer('subtotal_paisa').notNull(),
  discountPaisa: integer('discount_paisa').notNull().default(0),
  vatPaisa: integer('vat_paisa').notNull().default(0),
  totalPaisa: integer('total_paisa').notNull(),
  amountPaidPaisa: integer('amount_paid_paisa').notNull().default(0),
  changeDuePaisa: integer('change_due_paisa').notNull().default(0),
  notes: text('notes'),
  voidedReason: text('voided_reason'),
  voidedBy: text('voided_by'),
  voidedAt: text('voided_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  paidAt: text('paid_at'),
});

export const invoiceItems = sqliteTable('invoice_items', {
  id: text('id').primaryKey(),
  invoiceId: text('invoice_id').notNull(),
  variantId: text('variant_id').notNull(),
  productName: text('product_name').notNull(),
  variantLabel: text('variant_label').notNull(),
  sku: text('sku').notNull(),
  quantity: integer('quantity').notNull(),
  unitPricePaisa: integer('unit_price_paisa').notNull(),
  totalPricePaisa: integer('total_price_paisa').notNull(),
  createdAt: text('created_at').notNull(),
});

export const invoicePayments = sqliteTable('invoice_payments', {
  id: text('id').primaryKey(),
  invoiceId: text('invoice_id').notNull(),
  method: text('method', { enum: ['cash', 'card', 'bkash', 'nagad', 'rocket', 'bank_transfer', 'other'] }).notNull(),
  amountPaisa: integer('amount_paisa').notNull(),
  reference: text('reference'),
  createdAt: text('created_at').notNull(),
});

export const invoiceAudit = sqliteTable('invoice_audit', {
  id: text('id').primaryKey(),
  invoiceId: text('invoice_id').notNull(),
  actorStaffId: text('actor_staff_id'),
  action: text('action').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  metadataJson: text('metadata_json'),
  createdAt: text('created_at').notNull(),
});
