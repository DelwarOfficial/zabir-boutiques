import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  actorStaffId: text('actor_staff_id'),
  actorRole: text('actor_role'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  metadataJson: text('metadata_json'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  previousHash: text('previous_hash'),
  chainHash: text('chain_hash'),
  createdAt: text('created_at').notNull(),
});

export const auditCheckpoints = sqliteTable('audit_checkpoints', {
  id: text('id').primaryKey(),
  lastAuditId: text('last_audit_id').notNull(),
  chainHash: text('chain_hash').notNull(),
  createdAt: text('created_at').notNull(),
});

export const auditIntegrityAlerts = sqliteTable('audit_integrity_alerts', {
  id: text('id').primaryKey(),
  checkedAt: text('checked_at').notNull(),
  valid: integer('valid', { mode: 'boolean' }).notNull(),
  checkedRows: integer('checked_rows').notNull().default(0),
  firstBadIndex: integer('first_bad_index'),
  detailsJson: text('details_json'),
});

export const emailLog = sqliteTable('email_log', {
  id: text('id').primaryKey(),
  orderId: text('order_id'),
  emailType: text('email_type').notNull(),
  recipient: text('recipient'),
  status: text('status', { enum: ['queued', 'sent', 'failed', 'bounced'] }).notNull(),
  sentAt: text('sent_at'),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull(),
});

export const mediaObjects = sqliteTable('media_objects', {
  id: text('id').primaryKey(),
  r2Key: text('r2_key').notNull().unique(),
  bucket: text('bucket', { enum: ['MEDIA', 'BACKUPS'] }).notNull(),
  ownerType: text('owner_type', { enum: ['product', 'staff_upload', 'integration', 'client_private', 'backup'] }).notNull(),
  ownerId: text('owner_id').notNull(),
  visibility: text('visibility', { enum: ['public', 'staff', 'owner_only', 'private_client'] }).notNull(),
  contentType: text('content_type').notNull(),
  sha256: text('sha256'),
  uploadedByStaffId: text('uploaded_by_staff_id'),
  uploadedByApiKeyId: text('uploaded_by_api_key_id'),
  createdAt: text('created_at').notNull(),
});

export const siteSettings = sqliteTable('site_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull().default(''),
  type: text('type', { enum: ['text', 'textarea', 'number', 'boolean', 'image', 'phone', 'url', 'email'] }).notNull().default('text'),
  label: text('label').notNull(),
  description: text('description').notNull().default(''),
  groupName: text('group_name').notNull().default('general'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const customerConsent = sqliteTable('customer_consent', {
  id: text('id').primaryKey(),
  sessionId: text('session_id'),
  consentType: text('consent_type').notNull(),
  granted: integer('granted', { mode: 'boolean' }).notNull().default(false),
  grantedAt: text('granted_at'),
  ipAddress: text('ip_address'),
  createdAt: text('created_at').notNull(),
});

export const couponBruteForce = sqliteTable('coupon_brute_force', {
  sessionId: text('session_id').primaryKey(),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: text('locked_until'),
  lastAttemptAt: text('last_attempt_at').notNull(),
});

export const aiBudgetLimits = sqliteTable('ai_budget_limits', {
  provider: text('provider').primaryKey(),
  dailyLimitUsdCents: integer('daily_limit_usd_cents').notNull(),
  monthlyLimitUsdCents: integer('monthly_limit_usd_cents').notNull(),
  softAlertPercent: integer('soft_alert_percent').notNull().default(80),
  hardBlockPercent: integer('hard_block_percent').notNull().default(100),
  ownerOverride: integer('owner_override', { mode: 'boolean' }).notNull().default(false),
  updatedAt: text('updated_at').notNull(),
  updatedByStaffId: text('updated_by_staff_id'),
});

export const apiAuditLogs = sqliteTable('api_audit_logs', {
  auditId: text('audit_id').primaryKey(),
  provider: text('provider').notNull(),
  operation: text('operation').notNull(),
  requestId: text('request_id').notNull(),
  orderId: text('order_id'),
  invoiceId: text('invoice_id'),
  durationMs: integer('duration_ms'),
  status: text('status').notNull(),
  errorCode: text('error_code'),
  retryCount: integer('retry_count').notNull().default(0),
  circuitState: text('circuit_state'),
  redactedRequestSummary: text('redacted_request_summary'),
  redactedResponseSummary: text('redacted_response_summary'),
  createdAt: text('created_at').notNull(),
});

export const providerHealth = sqliteTable('provider_health', {
  provider: text('provider').primaryKey(),
  state: text('state', { enum: ['closed', 'open', 'half_open'] }).notNull(),
  lastFailureAt: text('lastFailureAt'),
  failureCount: integer('failureCount').default(0),
  resetAt: text('resetAt'),
  updatedAt: text('updatedAt').notNull(),
});

export const schemaMigrations = sqliteTable('schema_migrations', {
  version: text('version').primaryKey(),
  appliedAt: text('applied_at').notNull(),
});

/** Supply chain: the only legal way stock enters the system besides sales returns (T-26, RT-003). */
export const suppliers = sqliteTable('suppliers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone'),
  address: text('address'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
});

export const purchaseOrders = sqliteTable('purchase_orders', {
  id: text('id').primaryKey(),
  supplierId: text('supplier_id').notNull(),
  status: text('status', { enum: ['draft', 'ordered', 'received', 'cancelled'] }).notNull().default('draft'),
  totalCostPaisa: integer('total_cost_paisa').notNull().default(0),
  createdByStaffId: text('created_by_staff_id').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const goodsReceipts = sqliteTable('goods_receipts', {
  id: text('id').primaryKey(),
  purchaseOrderId: text('purchase_order_id'),
  variantId: text('variant_id').notNull(),
  quantity: integer('quantity').notNull(),
  unitCostPaisa: integer('unit_cost_paisa').notNull(),
  adjustmentId: text('adjustment_id').notNull(),
  receivedByStaffId: text('received_by_staff_id').notNull(),
  receivedAt: text('received_at').notNull(),
});

/** Courier COD remittance reconciliation (T-24, F-03). */
export const courierCodRemittance = sqliteTable('courier_cod_remittance', {
  id: text('id').primaryKey(),
  courier: text('courier').notNull(),
  periodStart: text('period_start').notNull(),
  periodEnd: text('period_end').notNull(),
  expectedPaisa: integer('expected_paisa').notNull(),
  receivedPaisa: integer('received_paisa').notNull(),
  reconciledByStaffId: text('reconciled_by_staff_id').notNull(),
  reconciledAt: text('reconciled_at').notNull(),
  createdAt: text('created_at').notNull(),
});
