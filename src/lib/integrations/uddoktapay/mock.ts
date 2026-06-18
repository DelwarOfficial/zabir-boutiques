import type { CreateCheckoutInput, CreateCheckoutResult, RefundPaymentInput, RefundPaymentResult } from './types';
import type { VerifiedPayment } from '../../payments';

export class MockUddoktaPayClient {
  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    return { ok: true, paymentUrl: `https://mock.uddoktapay.local/${input.invoiceId}`, rawResponse: '{}' };
  }

  async verifyPayment(invoiceId: string): Promise<VerifiedPayment> {
    return { status: 'paid', amountPaisa: 100, verifiedInvoiceId: invoiceId, metadata: {}, rawResponse: '{}' };
  }

  async refundPayment(_input: RefundPaymentInput): Promise<RefundPaymentResult> {
    return { ok: true, rawResponse: '{}' };
  }
}
