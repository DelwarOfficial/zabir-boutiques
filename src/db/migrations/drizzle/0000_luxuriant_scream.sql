CREATE TABLE `cart_activity` (
	`session_id` text PRIMARY KEY NOT NULL,
	`customer_phone` text,
	`customer_email` text,
	`customer_name` text,
	`item_count` integer DEFAULT 0 NOT NULL,
	`total_quantity` integer DEFAULT 0 NOT NULL,
	`subtotal_paisa` integer DEFAULT 0 NOT NULL,
	`last_cart_update_at` text NOT NULL,
	`checkout_started_at` text,
	`converted_order_id` text,
	`abandoned_email_sent_at` text,
	`consent_status` text DEFAULT 'unknown',
	`last_d1_write_at` text,
	`last_d1_write_source` text,
	`last_d1_write_seq` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `checkout_sessions` (
	`sessionId` text PRIMARY KEY NOT NULL,
	`productId` text NOT NULL,
	`variantId` text NOT NULL,
	`quantity` integer NOT NULL,
	`selectedOptions` text,
	`sourcePage` text,
	`utmParams` text,
	`createdAt` text NOT NULL,
	`deletedAt` text
);
--> statement-breakpoint
CREATE TABLE `direct_checkout_activity` (
	`session_id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`customer_phone` text,
	`customer_email` text,
	`customer_name` text,
	`source_page` text,
	`landing_version` integer DEFAULT 0 NOT NULL,
	`last_activity_at` text NOT NULL,
	`converted_order_id` text,
	`abandoned_email_sent_at` text,
	`consent_status` text DEFAULT 'unknown',
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `guest_carts` (
	`sessionId` text PRIMARY KEY NOT NULL,
	`items` text NOT NULL,
	`lastUpdatedAt` text NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`meta_title` text,
	`meta_description` text,
	`image_url` text,
	`parent_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);--> statement-breakpoint
CREATE TABLE `inventory_baseline` (
	`variant_id` text PRIMARY KEY NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`reserved_quantity` integer DEFAULT 0 NOT NULL,
	`sold_quantity` integer DEFAULT 0 NOT NULL,
	`baseline_hash` text NOT NULL,
	`set_at` text NOT NULL,
	`set_by` text,
	`reconciliation_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`reserved_quantity` integer DEFAULT 0 NOT NULL,
	`sold_quantity` integer DEFAULT 0 NOT NULL,
	`is_available` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_variant_id_unique` ON `inventory_items` (`variant_id`);--> statement-breakpoint
CREATE TABLE `low_stock_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`message` text NOT NULL,
	`is_acknowledged` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `product_images` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`alt_text` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_compressed` integer DEFAULT false NOT NULL,
	`width` integer,
	`height` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`sku` text NOT NULL,
	`size` text,
	`color` text,
	`price_paisa` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_sku_unique` ON `product_variants` (`sku`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`category_id` text,
	`price_paisa` integer NOT NULL,
	`compare_price_paisa` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`is_featured` integer DEFAULT false NOT NULL,
	`meta_title` text,
	`meta_description` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug_unique` ON `products` (`slug`);--> statement-breakpoint
CREATE TABLE `sitemap_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`last_modified` text NOT NULL,
	`priority` real DEFAULT 0.5 NOT NULL,
	`change_frequency` text DEFAULT 'weekly' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stock_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`adjusted_by` text,
	`prev_quantity` integer,
	`new_quantity` integer,
	`notes` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `checkout_idempotency` (
	`idempotency_key` text PRIMARY KEY NOT NULL,
	`order_id` text,
	`status` text NOT NULL,
	`response_body` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `checkout_idempotency_coupon_claims` (
	`idempotency_key` text NOT NULL,
	`claim_token` text NOT NULL,
	`code` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`idempotency_key`, `claim_token`)
);
--> statement-breakpoint
CREATE TABLE `coupons` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`discount_type` text NOT NULL,
	`discount_amount_paisa` integer,
	`discount_percent` integer,
	`max_discount_paisa` integer,
	`min_order_paisa` integer DEFAULT 0 NOT NULL,
	`usage_limit` integer,
	`used_count` integer DEFAULT 0 NOT NULL,
	`starts_at` text,
	`expires_at` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coupons_code_unique` ON `coupons` (`code`);--> statement-breakpoint
CREATE TABLE `customer_phone_otps` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`code_hash` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text
);
--> statement-breakpoint
CREATE TABLE `stock_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`release_requested_at` text
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`permissions` text DEFAULT '[]' NOT NULL,
	`scopes_json` text DEFAULT '[]' NOT NULL,
	`expires_at` text,
	`revoked_at` text,
	`allowed_ips_json` text DEFAULT '[]' NOT NULL,
	`rate_limit_profile` text DEFAULT 'strict' NOT NULL,
	`environment` text DEFAULT 'prod' NOT NULL,
	`purpose` text DEFAULT '' NOT NULL,
	`scope_version` integer DEFAULT 1 NOT NULL,
	`is_revoked` integer DEFAULT false NOT NULL,
	`last_used_at` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE TABLE `otp_secrets` (
	`staff_id` text PRIMARY KEY NOT NULL,
	`secret_cipher` text NOT NULL,
	`backup_codes_hash` text NOT NULL,
	`enabled_at` text NOT NULL,
	`last_used_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `password_reset_rate_limits` (
	`ip_address` text NOT NULL,
	`attempted_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`staff_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`revoked_at` text,
	`revoked_by` text,
	FOREIGN KEY (`staff_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_reset_tokens_token_hash_unique` ON `password_reset_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` text NOT NULL,
	`permission` text NOT NULL,
	`assigned_at` text NOT NULL,
	`assigned_by` text,
	PRIMARY KEY(`role_id`, `permission`),
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	`updated_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_name_unique` ON `roles` (`name`);--> statement-breakpoint
CREATE TABLE `session_blacklist` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`staff_user_id` text NOT NULL,
	`revoked_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`staff_user_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `staff_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`staff_user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`is_revoked` integer DEFAULT false NOT NULL,
	`expires_at` text NOT NULL,
	`absolute_expires_at` text NOT NULL,
	`last_active_at` text NOT NULL,
	`step_up_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`staff_user_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_sessions_token_hash_unique` ON `staff_sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `staff_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`phone` text,
	`password_hash` text NOT NULL,
	`password_salt` text,
	`full_name` text NOT NULL,
	`role` text DEFAULT 'support' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_login_at` text,
	`totp_secret` text,
	`totp_enrolled_at` text,
	`totp_required` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_users_email_unique` ON `staff_users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `staff_users_phone_unique` ON `staff_users` (`phone`);--> statement-breakpoint
CREATE TABLE `tamper_lockout` (
	`ip` text NOT NULL,
	`window_id` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` text NOT NULL,
	`alerted_at` text,
	PRIMARY KEY(`ip`, `window_id`)
);
--> statement-breakpoint
CREATE TABLE `fraud_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`phone` text NOT NULL,
	`risk_score` integer,
	`decision` text NOT NULL,
	`raw_response` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fraud_polls` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`process_id` text NOT NULL,
	`poll_count` integer DEFAULT 0 NOT NULL,
	`next_poll_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`product_name` text NOT NULL,
	`variant_label` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_paisa` integer NOT NULL,
	`total_price_paisa` integer NOT NULL,
	`vat_paisa` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `order_status_history` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`changed_by` text,
	`note` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`order_number` text NOT NULL,
	`phone` text NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`note` text,
	`shipping_zone` text,
	`subtotal_paisa` integer NOT NULL,
	`delivery_paisa` integer DEFAULT 0 NOT NULL,
	`discount_paisa` integer DEFAULT 0 NOT NULL,
	`vat_paisa` integer DEFAULT 0 NOT NULL,
	`total_paisa` integer NOT NULL,
	`payment_method` text NOT NULL,
	`payment_status` text DEFAULT 'created' NOT NULL,
	`fraud_decision` text DEFAULT 'review' NOT NULL,
	`status` text DEFAULT 'pending_review' NOT NULL,
	`created_by` text,
	`order_channel` text DEFAULT 'web',
	`advance_paisa` integer DEFAULT 0 NOT NULL,
	`balance_paisa` integer DEFAULT 0 NOT NULL,
	`courier_provider` text,
	`courier_tracking_number` text,
	`courier_handoff_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_order_number_unique` ON `orders` (`order_number`);--> statement-breakpoint
CREATE TABLE `payment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`event_type` text NOT NULL,
	`status` text NOT NULL,
	`raw_payload` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`invoice_id` text,
	`provider` text DEFAULT 'uddoktapay' NOT NULL,
	`amount_paisa` integer NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`checkout_url` text,
	`verified_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_invoice_id_unique` ON `payments` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `return_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`items_json` text NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`reviewed_by` text,
	`refund_amount_paisa` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invoice_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`actor_staff_id` text,
	`action` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`metadata_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invoice_items` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`product_name` text NOT NULL,
	`variant_label` text NOT NULL,
	`sku` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_paisa` integer NOT NULL,
	`total_price_paisa` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invoice_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`method` text NOT NULL,
	`amount_paisa` integer NOT NULL,
	`reference` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`receipt_no` text NOT NULL,
	`idempotency_key` text,
	`cashier_id` text NOT NULL,
	`customer_name` text,
	`customer_phone` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`subtotal_paisa` integer NOT NULL,
	`discount_paisa` integer DEFAULT 0 NOT NULL,
	`vat_paisa` integer DEFAULT 0 NOT NULL,
	`total_paisa` integer NOT NULL,
	`amount_paid_paisa` integer DEFAULT 0 NOT NULL,
	`change_due_paisa` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`voided_reason` text,
	`voided_by` text,
	`voided_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`paid_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_receipt_no_unique` ON `invoices` (`receipt_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_idempotency_key_unique` ON `invoices` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `ai_budget_limits` (
	`provider` text PRIMARY KEY NOT NULL,
	`daily_limit_usd_cents` integer NOT NULL,
	`monthly_limit_usd_cents` integer NOT NULL,
	`soft_alert_percent` integer DEFAULT 80 NOT NULL,
	`hard_block_percent` integer DEFAULT 100 NOT NULL,
	`owner_override` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_staff_id` text
);
--> statement-breakpoint
CREATE TABLE `api_audit_logs` (
	`audit_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`operation` text NOT NULL,
	`request_id` text NOT NULL,
	`order_id` text,
	`invoice_id` text,
	`duration_ms` integer,
	`status` text NOT NULL,
	`error_code` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`circuit_state` text,
	`redacted_request_summary` text,
	`redacted_response_summary` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`last_audit_id` text NOT NULL,
	`chain_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_integrity_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`checked_at` text NOT NULL,
	`valid` integer NOT NULL,
	`checked_rows` integer DEFAULT 0 NOT NULL,
	`first_bad_index` integer,
	`details_json` text
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_staff_id` text,
	`actor_role` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`metadata_json` text,
	`ip_address` text,
	`user_agent` text,
	`previous_hash` text,
	`chain_hash` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `coupon_brute_force` (
	`session_id` text PRIMARY KEY NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`last_attempt_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `customer_consent` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`consent_type` text NOT NULL,
	`granted` integer DEFAULT false NOT NULL,
	`granted_at` text,
	`ip_address` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_log` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text,
	`email_type` text NOT NULL,
	`recipient` text,
	`status` text NOT NULL,
	`sent_at` text,
	`error_message` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_objects` (
	`id` text PRIMARY KEY NOT NULL,
	`r2_key` text NOT NULL,
	`bucket` text NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`visibility` text NOT NULL,
	`content_type` text NOT NULL,
	`sha256` text,
	`uploaded_by_staff_id` text,
	`uploaded_by_api_key_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_objects_r2_key_unique` ON `media_objects` (`r2_key`);--> statement-breakpoint
CREATE TABLE `provider_health` (
	`provider` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`lastFailureAt` text,
	`failureCount` integer DEFAULT 0,
	`resetAt` text,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schema_migrations` (
	`version` text PRIMARY KEY NOT NULL,
	`applied_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `site_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`type` text DEFAULT 'text' NOT NULL,
	`label` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`group_name` text DEFAULT 'general' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
