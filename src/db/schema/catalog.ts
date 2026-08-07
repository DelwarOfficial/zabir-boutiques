import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  metaTitle: text('meta_title'),
  metaDescription: text('meta_description'),
  imageUrl: text('image_url'),
  parentId: text('parent_id'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  categoryId: text('category_id'),
  pricePaisa: integer('price_paisa').notNull(),
  comparePricePaisa: integer('compare_price_paisa'),
  status: text('status', { enum: ['draft', 'published', 'archived'] }).notNull().default('draft'),
  isFeatured: integer('is_featured', { mode: 'boolean' }).notNull().default(false),
  metaTitle: text('meta_title'),
  metaDescription: text('meta_description'),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const productVariants = sqliteTable('product_variants', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  sku: text('sku').notNull().unique(),
  size: text('size'),
  color: text('color'),
  pricePaisa: integer('price_paisa'),
  isDeleted: integer('is_deleted', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const productImages = sqliteTable('product_images', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  r2Key: text('r2_key').notNull(),
  altText: text('alt_text'),
  sortOrder: integer('sort_order').notNull().default(0),
  isCompressed: integer('is_compressed', { mode: 'boolean' }).notNull().default(false),
  width: integer('width'),
  height: integer('height'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const inventoryItems = sqliteTable('inventory_items', {
  id: text('id').primaryKey(),
  variantId: text('variant_id').notNull().unique().references(() => productVariants.id, { onDelete: 'restrict' }),
  quantity: integer('quantity').notNull().default(0),
  reservedQuantity: integer('reserved_quantity').notNull().default(0),
  soldQuantity: integer('sold_quantity').notNull().default(0),
  isAvailable: integer('is_available', { mode: 'boolean' }).notNull().default(true),
  updatedAt: text('updated_at').notNull(),
});

export const inventoryBaseline = sqliteTable('inventory_baseline', {
  variantId: text('variant_id').primaryKey().references(() => productVariants.id, { onDelete: 'restrict' }),
  quantity: integer('quantity').notNull().default(0),
  reservedQuantity: integer('reserved_quantity').notNull().default(0),
  soldQuantity: integer('sold_quantity').notNull().default(0),
  baselineHash: text('baseline_hash').notNull(),
  setAt: text('set_at').notNull(),
  setBy: text('set_by'),
  reconciliationCount: integer('reconciliation_count').notNull().default(0),
});

export const lowStockAlerts = sqliteTable('low_stock_alerts', {
  id: text('id').primaryKey(),
  variantId: text('variant_id').notNull().references(() => productVariants.id, { onDelete: 'restrict' }),
  message: text('message').notNull(),
  isAcknowledged: integer('is_acknowledged', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

export const stockAdjustments = sqliteTable('stock_adjustments', {
  id: text('id').primaryKey(),
  variantId: text('variant_id').notNull().references(() => productVariants.id, { onDelete: 'restrict' }),
  delta: integer('delta').notNull(),
  reason: text('reason').notNull(),
  adjustedBy: text('adjusted_by'),
  prevQuantity: integer('prev_quantity'),
  newQuantity: integer('new_quantity'),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
});

export const sitemapMetadata = sqliteTable('sitemap_metadata', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  lastModified: text('last_modified').notNull(),
  priority: real('priority').notNull().default(0.5),
  changeFrequency: text('change_frequency').notNull().default('weekly'),
});
