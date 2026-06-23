/**
 * Partial Prepayment Engine [Staff Operations v2]
 *
 * Business Rule: Orders with total quantity > 2 require
 * a 50% advance payment via UddoktaPay. Remaining balance is COD.
 *
 * Exemptions:
 * - In-store orders (payment_method === 'in_store') are always exempt.
 * - Full UddoktaPay (payment_method === 'uddoktapay') pays the full amount online.
 * - Partial prepay (payment_method === 'partial_prepay') is the retry path after
 *   a 402 — the customer pays the 50% advance online, balance on delivery.
 *
 * All amounts are INTEGER paisa. No floating-point arithmetic.
 */

export const PREPAYMENT_QUANTITY_THRESHOLD = 2;
export const PREPAYMENT_PERCENT = 50;

export const PREPAYMENT_MESSAGE =
  'Orders containing more than two items require a 50% advance payment to confirm the order. The remaining amount can be paid to the delivery person when receiving the parcel.';

export interface PrepaymentDecision {
  required: boolean;
  advancePaisa: number;
  balancePaisa: number;
  message: string | null;
}

/**
 * Determine whether a partial prepayment is required for the given order.
 *
 * @param totalQuantity Sum of all item quantities (not line count).
 * @param totalPaisa The server-computed total (subtotal + delivery - discount).
 * @param paymentMethod The payment method selected.
 */
export function calculatePrepayment(
  totalQuantity: number,
  totalPaisa: number,
  paymentMethod: string
): PrepaymentDecision {
  if (paymentMethod === 'in_store') {
    return { required: false, advancePaisa: 0, balancePaisa: 0, message: null };
  }

  if (paymentMethod === 'uddoktapay') {
    return { required: false, advancePaisa: totalPaisa, balancePaisa: 0, message: null };
  }

  if (paymentMethod === 'partial_prepay') {
    const advancePaisa = (totalPaisa + 1) >> 1;
    const balancePaisa = totalPaisa - advancePaisa;
    return { required: false, advancePaisa, balancePaisa, message: null };
  }

  if (totalQuantity <= PREPAYMENT_QUANTITY_THRESHOLD) {
    return { required: false, advancePaisa: 0, balancePaisa: totalPaisa, message: null };
  }

  const advancePaisa = (totalPaisa + 1) >> 1;
  const balancePaisa = totalPaisa - advancePaisa;

  return {
    required: true,
    advancePaisa,
    balancePaisa,
    message: PREPAYMENT_MESSAGE
  };
}
