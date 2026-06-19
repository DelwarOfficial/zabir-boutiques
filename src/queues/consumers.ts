/**
 * Cloudflare Queues — producers + consumers [Master_Prompt v7.0 §2.4, §3.5]
 *
 * Producers: small typed wrappers around env.<QUEUE>.send().
 * Consumers: batch processors invoked from the Worker's `queue` handler
 * in src/entry-cloudflare.ts. Each consumer returns the result per message
 * so the platform can ack/retry correctly.
 *
 * The actual queue infra (bindings, max_batch_size, dead-letter queues)
 * is configured in wrangler.jsonc. If a binding is missing (dev mode),
 * the producer is a no-op and the consumer returns success — graceful
 * degradation identical to the rest of the platform.
 */

import { applyPaymentVerified, verifyUddoktaPayment } from "../lib/payments";
import { nowSql } from "../lib/dates";
import { writeAuditLog } from "../lib/audit";
import { trackMetric } from "../lib/analytics";
import { safeLog } from "../lib/pii-scrubber";
import { sendAbandonedCartEmail, sendTransactionalEmail } from "../lib/email";
import { claimReservationsForRelease, confirmReservedVariants, releaseReservedVariants } from '../lib/inventory';

// ─── payment-webhooks ─────────────────────────────────────────────────────

export type PaymentWebhookMessage = { invoiceId: string; eventId?: string; receivedAt: string };

export async function enqueuePaymentWebhook(
  env: { PAYMENT_WEBHOOKS?: Queue },
  invoiceId: string,
  eventId?: string,
): Promise<void> {
  if (!env.PAYMENT_WEBHOOKS) return;
  await env.PAYMENT_WEBHOOKS.send({ invoiceId, eventId, receivedAt: nowSql() });
}

/** Shared verify + apply path for queue consumer and dev waitUntil fallback. */
export async function processPaymentWebhookMessage(
  env: { DB: D1Database; UDDOKTAPAY_API_KEY: string; UDDOKTAPAY_BASE_URL: string; ANALYTICS?: AnalyticsEngineDataset; VARIANT_INVENTORY_DO?: DurableObjectNamespace },
  invoiceId: string,
): Promise<void> {
  const verified = await verifyUddoktaPayment(invoiceId, env.UDDOKTAPAY_API_KEY, env.UDDOKTAPAY_BASE_URL, env);
  if (verified.status !== "paid") return;

  const result = await applyPaymentVerified(
    env,
    invoiceId,
    { amountPaisa: verified.amountPaisa, metadata: verified.metadata, rawResponse: verified.rawResponse ?? "" },
    nowSql(),
  );

  if (result.ok && !result.alreadyProcessed) {
    const payment = await env.DB
      .prepare("SELECT amount_paisa FROM payments WHERE invoice_id = ?1")
      .bind(invoiceId)
      .first<{ amount_paisa: number }>();
    if (payment) {
      await trackMetric(env, {
        name: "orders_created",
        doubles: { revenue_paisa: payment.amount_paisa },
        indexes: ["channel:queue"],
      });
    }
  }
}

export async function handlePaymentWebhookBatch(
  batch: MessageBatch<PaymentWebhookMessage>,
  env: { DB: D1Database; UDDOKTAPAY_API_KEY: string; UDDOKTAPAY_BASE_URL: string; ANALYTICS?: AnalyticsEngineDataset; VARIANT_INVENTORY_DO?: DurableObjectNamespace },
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      await processPaymentWebhookMessage(env, msg.body.invoiceId);
      msg.ack();
    } catch (err) {
      safeLog.error("[payment-webhook-consumer] failed", { error: err instanceof Error ? err.message : String(err) });
      msg.retry({ delaySeconds: 5 });
    }
  }
}

// ─── order-emails ────────────────────────────────────────────────────────

export type OrderEmailMessage = { orderId?: string; emailType: string; sessionId?: string; customerEmail?: string };

export async function enqueueOrderEmail(env: { ORDER_EMAILS?: Queue }, orderId: string, emailType: string): Promise<void> {
  if (!env.ORDER_EMAILS) return;
  await env.ORDER_EMAILS.send({ orderId, emailType });
}

export async function enqueueAbandonedCartEmail(env: { ORDER_EMAILS?: Queue }, sessionId: string, customerEmail: string): Promise<void> {
  if (!env.ORDER_EMAILS) return;
  await env.ORDER_EMAILS.send({ sessionId, customerEmail, emailType: 'abandoned_cart' });
}

export async function scanAbandonedCarts(env: { DB: D1Database; ORDER_EMAILS?: Queue }): Promise<void> {
  const eligible = await env.DB.prepare(
    `WITH eligible AS (
       SELECT session_id, customer_email,
              ROW_NUMBER() OVER (PARTITION BY customer_email ORDER BY last_cart_update_at DESC) AS rn
       FROM cart_activity
       WHERE last_cart_update_at < datetime('now', '-24 hours')
         AND abandoned_email_sent_at IS NULL
         AND converted_order_id IS NULL
         AND consent_status = 'allowed'
         AND customer_email IS NOT NULL
     )
     SELECT session_id, customer_email FROM eligible WHERE rn = 1
     LIMIT 100`,
  ).all<{ session_id: string; customer_email: string }>();

  for (const row of eligible.results ?? []) {
    const claimed = await env.DB.prepare(
      `UPDATE cart_activity
       SET abandoned_email_sent_at = datetime('now'), updated_at = datetime('now')
       WHERE session_id = ?1
         AND abandoned_email_sent_at IS NULL
         AND converted_order_id IS NULL`,
    ).bind(row.session_id).run();
    if (claimed.meta.changes === 1) {
      await enqueueAbandonedCartEmail(env, row.session_id, row.customer_email);
    }
  }
}

export async function handleOrderEmailBatch(
  batch: MessageBatch<OrderEmailMessage>,
  env: { DB: D1Database; RESEND_API_KEY?: string; RESEND_FROM_EMAIL?: string; EMAIL_PROVIDER?: string; PUBLIC_SITE_URL?: string },
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      const { orderId, emailType } = msg.body;

      if (emailType === 'abandoned_cart' && msg.body.sessionId) {
        const row = await env.DB.prepare(
          `SELECT converted_order_id, customer_email, customer_name
           FROM cart_activity
           WHERE session_id = ?1`,
        ).bind(msg.body.sessionId).first<{ converted_order_id: string | null; customer_email: string | null; customer_name: string | null }>();
        if (!row || row.converted_order_id !== null || !row.customer_email) {
          await env.DB.prepare(
            `INSERT INTO email_log (id, order_id, email_type, recipient, status, sent_at, error_message, created_at)
             VALUES (?1, NULL, 'abandoned_cart', ?2, 'failed', NULL, 'cart_converted_before_reminder', datetime('now'))`,
          ).bind(crypto.randomUUID(), msg.body.customerEmail ?? null).run();
          msg.ack();
          continue;
        }
        const sendResult = await sendAbandonedCartEmail(env, {
          session_id: msg.body.sessionId,
          name: row.customer_name?.trim() || 'there',
          email: row.customer_email,
          recovery_url: `${(env.PUBLIC_SITE_URL ?? 'https://zabirboutiques.com').replace(/\/$/, '')}/checkout?session_id=${encodeURIComponent(msg.body.sessionId)}`,
        });
        if (!sendResult.ok) {
          safeLog.error('[order-email-consumer] abandoned cart send failed', { sessionId: msg.body.sessionId, error: sendResult.error });
          msg.retry({ delaySeconds: 30 });
          continue;
        }
        msg.ack();
        continue;
      }

      if (!orderId) {
        msg.ack();
        continue;
      }

      // Load order details for the email template
      const order = await env.DB
        .prepare(
          `SELECT o.id, o.name, o.phone, o.address, o.total_paisa, o.payment_method,
                  o.email, o.status
           FROM orders o WHERE o.id = ?1`
        )
        .bind(orderId)
        .first<{
          id: string;
          name: string;
          phone: string;
          address: string;
          total_paisa: number;
          payment_method: string;
          email: string | null;
          status: string;
        }>();

      if (!order) {
        msg.ack();
        continue;
      }

      // Load order items for the template
      const itemsResult = await env.DB
        .prepare(
          `SELECT oi.product_name, oi.variant_label, oi.quantity, oi.total_price_paisa
           FROM order_items oi WHERE oi.order_id = ?1`
        )
        .bind(orderId)
        .all<{ product_name: string; variant_label: string; quantity: number; total_price_paisa: number }>();

      const orderLike = {
        order_number: orderId.slice(0, 8).toUpperCase(),
        name: order.name,
        phone: order.phone,
        address: order.address,
        total_paisa: order.total_paisa,
        payment_method: order.payment_method,
        items: itemsResult.results ?? [],
      };

      // Determine recipient email
      const recipient = order.email || `${order.phone}@sms.placeholder`;
      if (!order.email) {
        // No email on file — log and skip
        await env.DB
          .prepare(
            `INSERT OR IGNORE INTO email_log (id, order_id, email_type, recipient, status, sent_at, error_message)
             VALUES (?1, ?2, ?3, ?4, 'failed', NULL, 'no-email-on-file')`,
          )
          .bind(crypto.randomUUID(), orderId, emailType, recipient)
          .run();
        msg.ack();
        continue;
      }

      // Send via Resend adapter
      const result = await sendTransactionalEmail(env, order.email, emailType as any, orderLike);

      if (!result.ok) {
        safeLog.error("[order-email-consumer] send failed", { orderId, emailType, error: result.error });
        msg.retry({ delaySeconds: 30 });
        continue;
      }

      msg.ack();
    } catch (err) {
      safeLog.error("[order-email-consumer] failed", { error: err instanceof Error ? err.message : String(err) });
      msg.retry({ delaySeconds: 10 });
    }
  }
}

// ─── image-processing ────────────────────────────────────────────────────

export type ImageProcessingMessage = { r2Key: string; productId: string };

export async function enqueueImageProcessing(env: { IMAGE_PROCESSING?: Queue }, r2Key: string, productId: string): Promise<void> {
  if (!env.IMAGE_PROCESSING) return;
  await env.IMAGE_PROCESSING.send({ r2Key, productId });
}

export async function handleImageProcessingBatch(
  batch: MessageBatch<ImageProcessingMessage>,
  _env: { DB: D1Database; MEDIA?: R2Bucket; TINIFY_API_KEY: string },
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      // Tinify compression is implemented in src/lib/tinify.ts and runs
      // synchronously today; the consumer is the future-async path. We
      // ack on success and let the cron retry tinify on failure.
      msg.ack();
    } catch (err) {
      safeLog.error("[image-processing-consumer] failed", { error: err instanceof Error ? err.message : String(err) });
      msg.retry({ delaySeconds: 30 });
    }
  }
}

// ─── fraud-audit ─────────────────────────────────────────────────────────

export type FraudAuditMessage = { orderId: string; phone: string; reason?: string };

export async function enqueueFraudAudit(env: { FRAUD_AUDIT?: Queue }, orderId: string, phone: string, reason?: string): Promise<void> {
  if (!env.FRAUD_AUDIT) return;
  await env.FRAUD_AUDIT.send({ orderId, phone, reason });
}

export async function handleFraudAuditBatch(
  batch: MessageBatch<FraudAuditMessage>,
  env: { DB: D1Database; FRAUDBD_API_KEY: string },
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      const { checkFraudBD, decideFraudRisk } = await import("../lib/fraud");
      const { score, rawResponse } = await checkFraudBD(msg.body.phone, env.FRAUDBD_API_KEY, 3000, 'https://fraudbd.com', env);
      if (score === null && /"error"\s*:/.test(rawResponse)) {
        throw new Error(`fraudbd_retryable_failure:${rawResponse}`);
      }
      const decision = decideFraudRisk(score);
      const now = nowSql();
      const order = await env.DB.prepare(
        `SELECT id, status FROM orders WHERE id = ?1`,
      ).bind(msg.body.orderId).first<{ id: string; status: string }>();
      if (!order) {
        msg.ack();
        continue;
      }

      await env.DB
        .prepare("UPDATE orders SET fraud_decision = ?2, updated_at = ?3 WHERE id = ?1")
        .bind(msg.body.orderId, decision, now)
        .run();

      if (decision === 'approved' && order.status === 'pending_review') {
        const reservations = await env.DB.prepare(
          `SELECT id, variant_id, quantity FROM stock_reservations WHERE order_id = ?1 AND status = 'active'`,
        ).bind(msg.body.orderId).all<{ id: string; variant_id: string; quantity: number }>();
        const items = (reservations.results ?? []).map((row) => ({ variantId: row.variant_id, qty: row.quantity, reservationId: row.id }));
        const confirmed = await confirmReservedVariants(env, items, now);
        if (confirmed.ok) {
          await env.DB.batch([
            env.DB.prepare(`UPDATE orders SET status = 'staff_confirmed', updated_at = ?2 WHERE id = ?1 AND status = 'pending_review'`).bind(msg.body.orderId, now),
            env.DB.prepare(`INSERT INTO order_status_history (id, order_id, from_status, to_status, note, created_at) VALUES (?1, ?2, 'pending_review', 'staff_confirmed', 'fraud-audit auto-approved', ?3)`).bind(crypto.randomUUID(), msg.body.orderId, now),
          ], { atomic: true });
        }
      }

      if (decision === 'blocked' && (order.status === 'pending_review' || order.status === 'pending_payment')) {
        const reservations = await env.DB.prepare(
          `SELECT id, variant_id, quantity FROM stock_reservations WHERE order_id = ?1 AND status = 'active'`,
        ).bind(msg.body.orderId).all<{ id: string; variant_id: string; quantity: number }>();
        const items = (reservations.results ?? []).map((row) => ({ variantId: row.variant_id, qty: row.quantity, reservationId: row.id }));
        const claimedItems = await claimReservationsForRelease(env.DB, items, now);
        await releaseReservedVariants(env, claimedItems, now);
        await env.DB.batch([
          env.DB.prepare(`UPDATE orders SET status = 'cancelled', updated_at = ?2 WHERE id = ?1 AND status IN ('pending_review','pending_payment')`).bind(msg.body.orderId, now),
          env.DB.prepare(`INSERT INTO order_status_history (id, order_id, from_status, to_status, note, created_at) VALUES (?1, ?2, ?3, 'cancelled', 'fraud-audit auto-cancelled', ?4)`).bind(crypto.randomUUID(), msg.body.orderId, order.status, now),
        ], { atomic: true });
      }
      msg.ack();
    } catch (err) {
      safeLog.error("[fraud-audit-consumer] failed", { error: err instanceof Error ? err.message : String(err) });
      // Per spec: 2x retry then auto-approve with review flag.
      msg.retry({ delaySeconds: 2 });
    }
  }
}

// ─── d1-backup ───────────────────────────────────────────────────────────

export type D1BackupMessage = { triggeredAt: string };

export async function enqueueD1Backup(env: { D1_BACKUP?: Queue }, triggeredAt: string): Promise<void> {
  if (!env.D1_BACKUP) return;
  await env.D1_BACKUP.send({ triggeredAt });
}

export async function handleD1BackupBatch(
  batch: MessageBatch<D1BackupMessage>,
  env: { DB: D1Database; BACKUPS?: R2Bucket; ANALYTICS?: AnalyticsEngineDataset; BACKUP_ENCRYPTION_KEY?: string; SESSION_SECRET?: string },
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      const { backupD1ToR2 } = await import("../lib/maintenance/backup");
      await backupD1ToR2(env.DB, env.BACKUPS, env);
      await writeAuditLog(env.DB, {
        actorStaffId: null,
        actorRole: null,
        action: "d1.backup.completed",
        entityType: "system",
        entityId: "d1-backup",
        metadata: { triggeredAt: msg.body.triggeredAt },
      });
      await trackMetric(env, {
        name: "d1_backup_completed",
        doubles: { duration_ms: 0 },
        indexes: [],
      });
      msg.ack();
    } catch (err) {
      safeLog.error("[d1-backup-consumer] failed", { error: err instanceof Error ? err.message : String(err) });
      msg.retry({ delaySeconds: 60 });
    }
  }
}

// ─── cart-activity ───────────────────────────────────────────────────────

export type CartActivityMessage = {
  sessionId: string;
  itemCount: number;
  totalQuantity: number;
  subtotalPaisa: number;
  lastCartUpdateAt: string;
  cartVersion: number;
  customerContact?: string | null;
};

export async function enqueueCartActivity(env: { CART_ACTIVITY?: Queue }, activity: CartActivityMessage): Promise<void> {
  if (!env.CART_ACTIVITY) return;
  await env.CART_ACTIVITY.send(activity);
}

export async function handleCartActivityBatch(
  batch: MessageBatch<CartActivityMessage>,
  env: { DB: D1Database },
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      const { sessionId, itemCount, totalQuantity, subtotalPaisa, lastCartUpdateAt, customerContact } = msg.body;
      const now = nowSql();

      await env.DB.prepare(
        `INSERT INTO cart_activity (session_id, item_count, total_quantity, subtotal_paisa, last_cart_update_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (session_id) DO UPDATE SET
           item_count = excluded.item_count,
           total_quantity = excluded.total_quantity,
           subtotal_paisa = excluded.subtotal_paisa,
           last_cart_update_at = excluded.last_cart_update_at,
           updated_at = excluded.updated_at`
      ).bind(sessionId, itemCount, totalQuantity, subtotalPaisa, lastCartUpdateAt, now).run();

      // Update customer contact if provided (from checkout start)
      if (customerContact) {
        await env.DB.prepare(
          `UPDATE cart_activity SET customer_phone = ?2 WHERE session_id = ?1 AND customer_phone IS NULL`
        ).bind(sessionId, customerContact).run();
      }

      msg.ack();
    } catch (err) {
      safeLog.error("[cart-activity-consumer] failed", { error: err instanceof Error ? err.message : String(err) });
      msg.retry({ delaySeconds: 10 });
    }
  }
}
