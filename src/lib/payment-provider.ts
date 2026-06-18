/**
 * Payment Provider Interface [Master_Prompt v7.0 §2.6]
 *
 * Common interface for payment providers (UddoktaPay, SSLCommerz, etc.)
 * All payment operations must go through this interface.
 */

export interface CreatePaymentInput {
  orderId: string;
  amountPaisa: number;
  currency: string;
  customerName: string;
  customerEmail?: string;
  customerPhone: string;
  description?: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CreatePaymentResult {
  ok: boolean;
  paymentUrl?: string;
  transactionId?: string;
  error?: string;
}

export interface VerifyPaymentInput {
  orderId: string;
  transactionId?: string;
}

export interface VerifyPaymentResult {
  ok: boolean;
  status: 'paid' | 'pending' | 'failed' | 'cancelled';
  amountPaisa?: number;
  metadata?: Record<string, unknown>;
  rawResponse?: string;
  error?: string;
}

export interface RefundInput {
  orderId: string;
  transactionId: string;
  amountPaisa: number;
  reason?: string;
}

export interface RefundResult {
  ok: boolean;
  refundId?: string;
  error?: string;
}

export interface PaymentProvider {
  name: string;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult>;
  refund?(input: RefundInput): Promise<RefundResult>;
}
