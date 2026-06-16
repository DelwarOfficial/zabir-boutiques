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

import { verifyUddoktaPayment } from "../lib/payments";
import { nowSql } from "../lib/dates";
import { writeAuditLog } from "../lib/audit";
import { trackMetric } from "../lib/analytics";
import { confirmReservedVariants } from "../lib/inventory";

// ─── payment-webhooks ─────────────────────────────────────────────────────

export type PaymentWebhookMessage = { invoiceId: string; receivedAt: string };

export async function enqueuePaymentWebhook(env: { PAYMENT_WEBHOOKS?: Queue }, invoiceId: string): Promise<void> {
  if (!env.PAYMENT_WEBHOOKS) return;
  await env.PAYMENT_WEBHOOKS.send({ invoiceId, receivedAt: nowSql() });
}

export async function handlePaymentWebhookBatch(
  batch: MessageBatch<PaymentWebhookMessage>,
  env: { DB: D1Database; UDDOKTAPAY_API_KEY: string; UDDOKTAPAY_BASE_URL: string; ANALYTICS?: AnalyticsEngineDataset },
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      const { invoiceId } = msg.body;
      const verified = await verifyUddoktaPayment(invoiceId, env.UDDOKTAPAY_API_KEY, env.UDDOKTAPAY_BASE_URL);
      if (verified.status !== "paid") {
        msg.ack();
        continue;
      }
      const payment = await env.DB
        .prepare("SELECT id, order_id, amount_paisa, status FROM payments WHERE invoice_id = ?1")
        .bind(invoiceId)
        .first<{ id: string; order_id: string; amount_paisa: number; status: string }>();
      if (!payment) {
        msg.ack();
        continue;
      }
      // Idempotency via payment_events UNIQUE(invoice_id, event_type, status).
      const eventResult = await env.DB
        .prepare(
          `INSERT OR IGNORE INTO payment_events (id, payment_id, invoice_id, event_type, status, raw_payload, created_at)
           VALUES (?1, ?2, ?3, 'webhook', 'paid', ?4, ?5)`,
        )
        .bind(crypto.randomUUID(), payment.id, invoiceId, verified.rawResponse ?? "", nowSql())
        .run();
      if (eventResult.meta.changes === 0) {
        msg.ack();
        continue;
      }
      await env.DB
        .prepare("UPDATE payments SET status = 'paid', verified_at = ?2, updated_at = ?2 WHERE id = ?1")
        .bind(payment.id, nowSql())
        .run();

      // Deduct stock and mark reservations confirmed.
      const reservations = await env.DB
        .prepare("SELECT id, variant_id, quantity FROM stock_reservations WHERE order_id = ?1 AND status = 'active'")
        .bind(payment.order_id)
        .all<{ id: string; variant_id: string; quantity: number }>();
      const items = (reservations.results ?? []).map(r => ({ variantId: r.variant_id, qty: r.quantity }));
      if (items.length > 0) {
        await confirmReservedVariants({ DB: env.DB }, items, nowSql());
        await env.DB
          .prepare("UPDATE stock_reservations SET status = 'confirmed', updated_at = ?2 WHERE order_id = ?1 AND status = 'active'")
          .bind(payment.order_id, nowSql())
          .run();
      }
      await env.DB
        .prepare("UPDATE orders SET payment_status = 'paid', status = 'payment_verified', updated_at = ?2 WHERE id = ?1")
        .bind(payment.order_id, nowSql())
        .run();

      await trackMetric(env, {
        name: "orders_created",
        doubles: { revenue_paisa: payment.amount_paisa },
        indexes: ["channel:queue"],
      });
      msg.ack();
    } catch (err) {
      console.error("[payment-webhook-consumer]", err);
      msg.retry({ delaySeconds: 5 });
    }
  }
}

// ─── order-emails ────────────────────────────────────────────────────────

export type OrderEmailMessage = { orderId: string; emailType: string };

export async function enqueueOrderEmail(env: { ORDER_EMAILS?: Queue }, orderId: string, emailType: string): Promise<void> {
  if (!env.ORDER_EMAILS) return;
  await env.ORDER_EMAILS.send({ orderId, emailType });
}

export async function handleOrderEmailBatch(
  batch: MessageBatch<OrderEmailMessage>,
  env: { DB: D1Database; RESEND_API_KEY?: string; RESEND_FROM_EMAIL?: string },
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      // Email rendering + send is implemented in src/lib/email.ts (Phase 4).
      // For now, record a row in email_log so Phase 4 can replay.
      const now = nowSql();
      await env.DB
        .prepare(
          `INSERT OR IGNORE INTO email_log (id, order_id, email_type, recipient, status, sent_at, error_message)
           VALUES (?1, ?2, ?3, ?4, 'queued', ?5, NULL)`,
        )
        .bind(crypto.randomUUID(), msg.body.orderId, msg.body.emailType, "", now)
        .run();
      msg.ack();
    } catch (err) {
      console.error("[order-email-consumer]", err);
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
      console.error("[image-processing-consumer]", err);
      msg.retry({ delaySeconds: 30 });
    }
  }
}

// ─── fraud-scoring ───────────────────────────────────────────────────────

export type FraudScoringMessage = { orderId: string; phone: string };

export async function enqueueFraudScoring(env: { FRAUD_SCORING?: Queue }, orderId: string, phone: string): Promise<void> {
  if (!env.FRAUD_SCORING) return;
  await env.FRAUD_SCORING.send({ orderId, phone });
}

export async function handleFraudScoringBatch(
  batch: MessageBatch<FraudScoringMessage>,
  env: { DB: D1Database; FRAUDBD_API_KEY: string },
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      const { checkFraudBD, decideFraudRisk } = await import("../lib/fraud");
      const { score } = await checkFraudBD(msg.body.phone, env.FRAUDBD_API_KEY);
      const decision = decideFraudRisk(score);
      await env.DB
        .prepare("UPDATE orders SET fraud_decision = ?2, updated_at = ?3 WHERE id = ?1")
        .bind(msg.body.orderId, decision, nowSql())
        .run();
      msg.ack();
    } catch (err) {
      console.error("[fraud-scoring-consumer]", err);
      // Per spec: 2x retry then auto-approve with review flag.
      msg.retry({ delaySeconds: 10 });
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
  env: { DB: D1Database; BACKUPS?: R2Bucket; ANALYTICS?: AnalyticsEngineDataset },
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      const { backupD1ToR2 } = await import("../lib/maintenance/backup");
      await backupD1ToR2(env.DB, env.BACKUPS);
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
      console.error("[d1-backup-consumer]", err);
      msg.retry({ delaySeconds: 60 });
    }
  }
}
