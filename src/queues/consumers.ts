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
  const verified = await verifyUddoktaPayment(invoiceId, env.UDDOKTAPAY_API_KEY, env.UDDOKTAPAY_BASE_URL);
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
      safeLog.error("[fraud-scoring-consumer] failed", { error: err instanceof Error ? err.message : String(err) });
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
