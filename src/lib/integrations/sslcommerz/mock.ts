import type { CreateCheckoutInput, CreateCheckoutResult } from './types';
import type { VerifiedPayment } from '../../payments';

export class SSLCommerzMockClient {
  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    return {
      ok: true,
      paymentUrl: `https://mock.sslcommerz.local/gw/${input.invoiceId}`,
      rawResponse: JSON.stringify({ status: 'SUCCESS', GatewayPageURL: `https://mock.sslcommerz.local/gw/${input.invoiceId}` }),
    };
  }

  async verifyPayment(invoiceId: string): Promise<VerifiedPayment> {
    return {
      status: 'paid',
      amountPaisa: 10000,
      verifiedInvoiceId: invoiceId,
      metadata: { order_id: 'mock-order' },
      rawResponse: JSON.stringify({ status: 'VALID', tran_id: invoiceId, amount: '100.00' }),
    };
  }
}