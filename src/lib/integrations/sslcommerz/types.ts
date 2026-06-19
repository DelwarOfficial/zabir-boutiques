import type { PaymentStatus, VerifiedPayment } from '../../payments';

export interface SSLCommerzEnv {
  SSLCOMMERZ_STORE_ID?: string;
  SSLCOMMERZ_STORE_PASSWORD?: string;
  SSLCOMMERZ_BASE_URL?: string;
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

export type { PaymentStatus, VerifiedPayment };