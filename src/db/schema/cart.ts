import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const cartActivity = sqliteTable('cart_activity', {
  sessionId: text('session_id').primaryKey(),
  customerPhone: text('customer_phone'),
  customerEmail: text('customer_email'),
  customerName: text('customer_name'),
  itemCount: integer('item_count').notNull().default(0),
  totalQuantity: integer('total_quantity').notNull().default(0),
  subtotalPaisa: integer('subtotal_paisa').notNull().default(0),
  lastCartUpdateAt: text('last_cart_update_at').notNull(),
  checkoutStartedAt: text('checkout_started_at'),
  convertedOrderId: text('converted_order_id'),
  abandonedEmailSentAt: text('abandoned_email_sent_at'),
  consentStatus: text('consent_status', { enum: ['unknown', 'allowed', 'denied'] }).default('unknown'),
  lastD1WriteAt: text('last_d1_write_at'),
  lastD1WriteSource: text('last_d1_write_source', { enum: ['alarm', 'cart_activity_queue', 'lifecycle_cleanup'] }),
  lastD1WriteSeq: integer('last_d1_write_seq').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});

export const directCheckoutActivity = sqliteTable('direct_checkout_activity', {
  sessionId: text('session_id').primaryKey(),
  productId: text('product_id').notNull(),
  variantId: text('variant_id').notNull(),
  quantity: integer('quantity').notNull().default(0),
  customerPhone: text('customer_phone'),
  customerEmail: text('customer_email'),
  customerName: text('customer_name'),
  sourcePage: text('source_page'),
  landingVersion: integer('landing_version').notNull().default(0),
  lastActivityAt: text('last_activity_at').notNull(),
  convertedOrderId: text('converted_order_id'),
  abandonedEmailSentAt: text('abandoned_email_sent_at'),
  consentStatus: text('consent_status', { enum: ['unknown', 'allowed', 'denied'] }).default('unknown'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const guestCarts = sqliteTable('guest_carts', {
  sessionId: text('sessionId').primaryKey(),
  items: text('items', { mode: 'json' }).notNull(),
  lastUpdatedAt: text('lastUpdatedAt').notNull(),
  version: integer('version').notNull(),
});

export const checkoutSessions = sqliteTable('checkout_sessions', {
  sessionId: text('sessionId').primaryKey(),
  productId: text('productId').notNull(),
  variantId: text('variantId').notNull(),
  quantity: integer('quantity').notNull(),
  selectedOptions: text('selectedOptions', { mode: 'json' }),
  sourcePage: text('sourcePage'),
  utmParams: text('utmParams', { mode: 'json' }),
  createdAt: text('createdAt').notNull(),
  deletedAt: text('deletedAt'),
});
