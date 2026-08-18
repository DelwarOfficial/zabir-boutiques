import type { PaymentStatus, VerifiedPayment } from '../../payments';

export interface UddoktaPayEnv {
  UDDOKTAPAY_API_KEY?: string;
  UDDOKTAPAY_BASE_URL?: string;
  /**
   * N-28: retained only so existing env typing keeps compiling. UddoktaPay
   * authenticates webhooks with RT-UDDOKTAPAY-API-KEY, not an HMAC signature
   * (verified against the provider's validate-webhook docs), so nothing reads
   * this any more.
   */
  UDDOKTAPAY_WEBHOOK_SECRET?: string;
  PUBLIC_SITE_URL?: string;
  DB?: D1Database;
  PROVIDER_HEALTH_DO?: DurableObjectNamespace;
}

export interface CreateCheckoutInput {
  /** Our internal payments.id. Sent as metadata.payment_id, never as invoice_id. */
  paymentId: string;
  amountPaisa: number;
  customerName: string;
  /** Real customer email. The provider requires it; no placeholder is acceptable. */
  customerEmail: string;
  orderId: string;
  redirectUrl: string;
  cancelUrl: string;
  webhookUrl?: string;
  type: 'partial_prepay' | 'full';
}

export interface CreateCheckoutResult {
  ok: boolean;
  paymentUrl?: string;
  /** Random per-attempt value echoed through metadata to correlate callbacks. */
  correlationId?: string;
  rawResponse: string;
  errorCode?: string;
}

export interface RefundPaymentInput {
  /** From the verified payment. The provider's refund API does not accept invoice_id. */
  transactionId: string;
  paymentMethod: string;
  amountPaisa: number;
  productName: string;
  reason: string;
}

export interface RefundPaymentResult {
  ok: boolean;
  rawResponse: string;
  errorCode?: string;
}

export type { PaymentStatus, VerifiedPayment };
