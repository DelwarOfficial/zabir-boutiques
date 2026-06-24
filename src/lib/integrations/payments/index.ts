import { UddoktaPayClient, type CreateCheckoutInput as UddoktaCheckoutInput } from '../uddoktapay';
import { SSLCommerzClient } from '../sslcommerz';
import type { VerifiedPayment } from '../../payments';

export type PaymentProviderName = 'uddoktapay' | 'sslcommerz';

export type PaymentCheckoutEnv = {
  UDDOKTAPAY_API_KEY?: string;
  UDDOKTAPAY_BASE_URL?: string;
  SSLCOMMERZ_STORE_ID?: string;
  SSLCOMMERZ_STORE_PASSWORD?: string;
  SSLCOMMERZ_BASE_URL?: string;
  DB?: D1Database;
  PROVIDER_HEALTH_DO?: DurableObjectNamespace;
};

export interface PaymentCheckoutResult {
  ok: boolean;
  provider: PaymentProviderName;
  paymentUrl?: string;
  rawResponse: string;
  errorCode?: string;
}

export async function createPaymentCheckout(
  env: PaymentCheckoutEnv,
  input: UddoktaCheckoutInput,
): Promise<PaymentCheckoutResult> {
  const primary = await new UddoktaPayClient(env).createCheckout(input);
  if (primary.ok && primary.paymentUrl) {
    return { ok: true, provider: 'uddoktapay', paymentUrl: primary.paymentUrl, rawResponse: primary.rawResponse };
  }

  const fallback = await new SSLCommerzClient(env).createCheckout(input);
  if (fallback.ok && fallback.paymentUrl) {
    return { ok: true, provider: 'sslcommerz', paymentUrl: fallback.paymentUrl, rawResponse: fallback.rawResponse };
  }

  return {
    ok: false,
    provider: 'uddoktapay',
    rawResponse: primary.rawResponse || fallback.rawResponse,
    errorCode: primary.errorCode ?? fallback.errorCode ?? 'PAYMENT_PROVIDER_UNAVAILABLE',
  };
}

export async function verifyPaymentForProvider(
  env: PaymentCheckoutEnv,
  provider: PaymentProviderName,
  invoiceId: string,
): Promise<VerifiedPayment> {
  if (provider === 'sslcommerz') {
    return new SSLCommerzClient(env).verifyPayment(invoiceId);
  }
  return new UddoktaPayClient({
    ...env,
    UDDOKTAPAY_API_KEY: env.UDDOKTAPAY_API_KEY ?? '',
    UDDOKTAPAY_BASE_URL: env.UDDOKTAPAY_BASE_URL ?? '',
  }).verifyPayment(invoiceId);
}