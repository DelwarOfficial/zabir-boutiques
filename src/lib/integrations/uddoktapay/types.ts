import type { PaymentStatus, VerifiedPayment } from '../../payments';

export interface UddoktaPayEnv {
  UDDOKTAPAY_API_KEY?: string;
  UDDOKTAPAY_BASE_URL?: string;
  UDDOKTAPAY_WEBHOOK_SECRET?: string;
  DB?: D1Database;
  PROVIDER_HEALTH_DO?: DurableObjectNamespace;
}

export interface CreateCheckoutInput {
  invoiceId: string;
  amountPaisa: number;
  customerName: string;
  customerPhone: string;
  orderId: string;
  redirectUrl: string;
  cancelUrl: string;
  type: 'partial_prepay' | 'full';
}

export interface CreateCheckoutResult {
  ok: boolean;
  paymentUrl?: string;
  rawResponse: string;
  errorCode?: string;
}

export interface RefundPaymentInput {
  invoiceId: string;
  amountPaisa: number;
  reason: string;
}

export interface RefundPaymentResult {
  ok: boolean;
  rawResponse: string;
  errorCode?: string;
}

export type { PaymentStatus, VerifiedPayment };
