import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const coupons = sqliteTable('coupons', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  discountType: text('discount_type', { enum: ['fixed', 'percentage'] }).notNull(),
  discountAmountPaisa: integer('discount_amount_paisa'),
  discountPercent: integer('discount_percent'),
  maxDiscountPaisa: integer('max_discount_paisa'),
  minOrderPaisa: integer('min_order_paisa').notNull().default(0),
  usageLimit: integer('usage_limit'),
  usedCount: integer('used_count').notNull().default(0),
  startsAt: text('starts_at'),
  expiresAt: text('expires_at'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const stockReservations = sqliteTable('stock_reservations', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull(),
  variantId: text('variant_id').notNull(),
  quantity: integer('quantity').notNull(),
  status: text('status', { enum: ['active', 'release_requested', 'confirmed', 'released', 'expired'] }).notNull().default('active'),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  releaseRequestedAt: text('release_requested_at'),
});

export const checkoutIdempotency = sqliteTable('checkout_idempotency', {
  idempotencyKey: text('idempotency_key').primaryKey(),
  orderId: text('order_id'),
  status: text('status', { enum: ['processing', 'complete', 'failed'] }).notNull(),
  responseBody: text('response_body'),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
});

export const checkoutIdempotencyCouponClaims = sqliteTable('checkout_idempotency_coupon_claims', {
  idempotencyKey: text('idempotency_key').notNull(),
  claimToken: text('claim_token').notNull(),
  code: text('code').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.idempotencyKey, table.claimToken] }),
}));

export const customerPhoneOtps = sqliteTable('customer_phone_otps', {
  id: text('id').primaryKey(),
  phone: text('phone').notNull(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  consumedAt: text('consumed_at'),
});
