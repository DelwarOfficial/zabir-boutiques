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
  /** Opt-in kill switch for the fallback provider — see isSslcommerzEnabled. */
  SSLCOMMERZ_ENABLED?: string;
  DB?: D1Database;
  PROVIDER_HEALTH_DO?: DurableObjectNamespace;
};

export interface PaymentCheckoutResult {
  ok: boolean;
  provider: PaymentProviderName;
  paymentUrl?: string;
  correlationId?: string;
  rawResponse: string;
  errorCode?: string;
}

/**
 * N-28: outcomes where we know for certain no charge was created upstream, so
 * failing over to SSLCommerz cannot double-charge.
 *
 * TIMEOUT and REQUEST_FAILED are deliberately absent: a create-charge that
 * timed out may well have succeeded on the provider side, and sending that
 * customer to a second provider would take payment twice for one order. Those
 * cases surface as a failure and let the customer retry against a payment
 * record we can reconcile, rather than silently switching provider.
 */
const UNAMBIGUOUS_PRIMARY_FAILURES = new Set([
  'NOT_CONFIGURED',
  'CIRCUIT_OPEN',
  'BAD_RESPONSE',
  'UNTRUSTED_PAYMENT_URL',
]);

/**
 * SSLCommerz is currently switched OFF.
 *
 * The fallback is opt-in rather than opt-out: it engages only when
 * SSLCOMMERZ_ENABLED is exactly "true". Leaving the adapter, its tests and its
 * credentials in place means turning it back on is a one-value config change,
 * with no code to re-add under time pressure during an UddoktaPay outage.
 *
 * Note this is deliberately independent of whether the store credentials
 * happen to be set: an unconfigured provider fails at the call and looks like
 * an outage, whereas this reads as the decision it is.
 */
export function isSslcommerzEnabled(env: PaymentCheckoutEnv): boolean {
  return env.SSLCOMMERZ_ENABLED === 'true';
}

function canSafelyFailOver(errorCode: string | undefined): boolean {
  if (!errorCode) return false;
  if (UNAMBIGUOUS_PRIMARY_FAILURES.has(errorCode)) return true;
  // A 4xx means the provider received and rejected the request outright.
  // A 5xx is ambiguous — it may have been created before the error.
  const http = /^HTTP_(\d{3})$/.exec(errorCode);
  return http ? Number(http[1]) >= 400 && Number(http[1]) < 500 : false;
}

export async function createPaymentCheckout(
  env: PaymentCheckoutEnv,
  input: UddoktaCheckoutInput & { invoiceId?: string; customerPhone?: string },
): Promise<PaymentCheckoutResult> {
  const primary = await new UddoktaPayClient(env).createCheckout(input);
  if (primary.ok && primary.paymentUrl) {
    return {
      ok: true, provider: 'uddoktapay', paymentUrl: primary.paymentUrl,
      correlationId: primary.correlationId, rawResponse: primary.rawResponse,
    };
  }

  if (!isSslcommerzEnabled(env) || !canSafelyFailOver(primary.errorCode)) {
    return {
      ok: false,
      provider: 'uddoktapay',
      rawResponse: primary.rawResponse,
      errorCode: primary.errorCode ?? 'PAYMENT_PROVIDER_UNAVAILABLE',
    };
  }

  const fallback = await new SSLCommerzClient(env).createCheckout({
    ...input,
    // SSLCommerz still uses a merchant-generated invoice id.
    invoiceId: input.invoiceId ?? input.paymentId,
    customerPhone: input.customerPhone ?? '',
  });
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