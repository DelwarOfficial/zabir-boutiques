import type { CreateCheckoutInput, CreateCheckoutResult, RefundPaymentInput, RefundPaymentResult } from './types';
import type { VerifiedPayment } from '../../payments';

export class MockUddoktaPayClient {
  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    // The provider generates the invoice id, so the mock URL is keyed on our
    // own payment id — mirroring the real flow where no invoice exists yet.
    return {
      ok: true,
      paymentUrl: `https://mock.uddoktapay.local/${input.paymentId}`,
      correlationId: 'mock-correlation',
      rawResponse: '{}',
    };
  }

  async verifyPayment(invoiceId: string): Promise<VerifiedPayment> {
    return {
      status: 'paid',
      amountPaisa: 100,
      verifiedInvoiceId: invoiceId,
      metadata: {},
      transactionId: 'MOCKTRX1',
      paymentMethod: 'bkash',
      rawResponse: '{}',
    };
  }

  async refundPayment(_input: RefundPaymentInput): Promise<RefundPaymentResult> {
    return { ok: true, rawResponse: '{}' };
  }
}
