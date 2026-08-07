import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  orderNumber: text('order_number').notNull().unique(),
  phone: text('phone').notNull(),
  name: text('name').notNull(),
  address: text('address').notNull(),
  note: text('note'),
  shippingZone: text('shipping_zone'),
  subtotalPaisa: integer('subtotal_paisa').notNull(),
  deliveryPaisa: integer('delivery_paisa').notNull().default(0),
  discountPaisa: integer('discount_paisa').notNull().default(0),
  vatPaisa: integer('vat_paisa').notNull().default(0),
  totalPaisa: integer('total_paisa').notNull(),
  paymentMethod: text('payment_method', { enum: ['cod', 'uddoktapay', 'partial_prepay', 'in_store'] }).notNull(),
  paymentStatus: text('payment_status', { enum: ['created', 'pending', 'processing', 'paid', 'partially_paid', 'failed', 'cancelled', 'expired', 'refunded'] }).notNull().default('created'),
  fraudDecision: text('fraud_decision', { enum: ['approved', 'review', 'blocked'] }).notNull().default('review'),
  status: text('status', { enum: ['pending_review', 'pending_payment', 'payment_verified', 'paid_over_allocated', 'staff_confirmed', 'packing', 'shipped', 'delivered', 'returned', 'cancelled', 'refunded'] }).notNull().default('pending_review'),
  createdBy: text('created_by'),
  orderChannel: text('order_channel', { enum: ['web', 'in_store', 'phone', 'messenger', 'whatsapp'] }).default('web'),
  advancePaisa: integer('advance_paisa').notNull().default(0),
  balancePaisa: integer('balance_paisa').notNull().default(0),
  courierProvider: text('courier_provider'),
  courierTrackingNumber: text('courier_tracking_number'),
  courierHandoffAt: text('courier_handoff_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const orderItems = sqliteTable('order_items', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull(),
  variantId: text('variant_id').notNull(),
  productName: text('product_name').notNull(),
  variantLabel: text('variant_label').notNull(),
  quantity: integer('quantity').notNull(),
  unitPricePaisa: integer('unit_price_paisa').notNull(),
  totalPricePaisa: integer('total_price_paisa').notNull(),
  vatPaisa: integer('vat_paisa').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

export const orderStatusHistory = sqliteTable('order_status_history', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  changedBy: text('changed_by'),
  note: text('note'),
  createdAt: text('created_at').notNull(),
});

export const payments = sqliteTable('payments', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull(),
  invoiceId: text('invoice_id').unique(),
  provider: text('provider').notNull().default('uddoktapay'),
  amountPaisa: integer('amount_paisa').notNull(),
  status: text('status', { enum: ['created', 'pending', 'processing', 'paid', 'failed', 'cancelled', 'expired', 'refunded'] }).notNull().default('created'),
  checkoutUrl: text('checkout_url'),
  verifiedAt: text('verified_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const paymentEvents = sqliteTable('payment_events', {
  id: text('id').primaryKey(),
  paymentId: text('payment_id').notNull(),
  invoiceId: text('invoice_id').notNull(),
  eventType: text('event_type').notNull(),
  status: text('status').notNull(),
  rawPayload: text('raw_payload'),
  createdAt: text('created_at').notNull(),
});

export const returnRequests = sqliteTable('return_requests', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull(),
  itemsJson: text('items_json').notNull(),
  reason: text('reason').notNull(),
  status: text('status', { enum: ['pending', 'approved', 'rejected', 'completed'] }).notNull(),
  reviewedBy: text('reviewed_by'),
  refundAmountPaisa: integer('refund_amount_paisa').notNull().default(0),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const fraudChecks = sqliteTable('fraud_checks', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull(),
  phone: text('phone').notNull(),
  riskScore: integer('risk_score'),
  decision: text('decision', { enum: ['approved', 'review', 'blocked'] }).notNull(),
  rawResponse: text('raw_response'),
  createdAt: text('created_at').notNull(),
});

export const fraudPolls = sqliteTable('fraud_polls', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull(),
  processId: text('process_id').notNull(),
  pollCount: integer('poll_count').notNull().default(0),
  nextPollAt: text('next_poll_at').notNull(),
  status: text('status', { enum: ['pending', 'resolved', 'timeout', 'failed'] }).notNull().default('pending'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
