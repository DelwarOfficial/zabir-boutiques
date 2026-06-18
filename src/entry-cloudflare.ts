/**
 * Cloudflare Worker Entry [v6.8D + Master_Prompt v7.0]
 *
 * Composes the Astro SSR fetch handler, the cron handler, the queue
 * handler, and the Durable Object class exports. Per Cloudflare's
 * binding contract, DO classes MUST be exported from the main module
 * so wrangler can wire them into the Workers runtime.
 */
import { default as astroHandler } from "@astrojs/cloudflare/entrypoints/server";
import { dispatchCron } from "./lib/cron-dispatch";
import {
  handlePaymentWebhookBatch,
  handleOrderEmailBatch,
  handleImageProcessingBatch,
  handleFraudScoringBatch,
  handleD1BackupBatch,
  handleCartActivityBatch,
  type PaymentWebhookMessage,
  type OrderEmailMessage,
  type ImageProcessingMessage,
  type FraudScoringMessage,
  type D1BackupMessage,
  type CartActivityMessage,
} from "./queues/consumers";
import { VariantInventoryDO } from "./do/variant-inventory-do";
import { IdempotencyDO } from "./do/idempotency-do";
import { BudgetCounterDO } from "./do/budget-counter-do";
import { WafRules } from "./do/waf-rules";
import { CartDO } from "./do/cart-do";
import { DirectCheckoutSessionDO } from "./do/direct-checkout-session-do";
import { ProviderHealthDO } from "./do/provider-health-do";
import { safeLog } from "./lib/pii-scrubber";
import type { Env } from "./env";

// Required by Cloudflare: DO classes must be top-level exports.
export { VariantInventoryDO, IdempotencyDO, BudgetCounterDO, WafRules, CartDO, DirectCheckoutSessionDO, ProviderHealthDO };

async function routeQueue(batch: MessageBatch, env: Env): Promise<void> {
  switch (batch.queue) {
    case "payment-webhooks":
      await handlePaymentWebhookBatch(batch as MessageBatch<PaymentWebhookMessage>, env);
      break;
    case "order-emails":
      await handleOrderEmailBatch(batch as MessageBatch<OrderEmailMessage>, env);
      break;
    case "image-processing":
      await handleImageProcessingBatch(batch as MessageBatch<ImageProcessingMessage>, env);
      break;
    case "fraud-scoring":
      await handleFraudScoringBatch(batch as MessageBatch<FraudScoringMessage>, env);
      break;
    case "d1-backup":
      await handleD1BackupBatch(batch as MessageBatch<D1BackupMessage>, env);
      break;
    case "cart-activity":
      await handleCartActivityBatch(batch as MessageBatch<CartActivityMessage>, env);
      break;
    default:
      safeLog.warn("[queue] Unknown queue", { queue: batch.queue });
      for (const m of batch.messages) m.ack();
  }
}

export default {
  async fetch(request, env, ctx) {
    const handler = (astroHandler as ExportedHandler<Env>).fetch;
    if (!handler) throw new Error("Astro SSR handler does not export fetch");
    return handler.call(astroHandler, request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    safeLog.info("[cron] Triggered", { cron: event.cron });
    ctx.waitUntil(dispatchCron(event.cron, env as unknown as Env));
  },
  async queue(batch, env) {
    await routeQueue(batch, env as unknown as Env);
  },
} satisfies ExportedHandler<Env>;
