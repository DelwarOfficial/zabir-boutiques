export interface PaymentProviderContract {
  createPayment(input: unknown): Promise<unknown>;
  verifyPayment(input: unknown): Promise<unknown>;
  parseWebhook(request: Request): Promise<unknown>;
  refund?(input: unknown): Promise<unknown>;
}
