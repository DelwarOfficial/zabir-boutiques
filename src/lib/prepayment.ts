/**
 * Partial Prepayment Engine [Staff Operations v2]
 *
 * Business Rule: Orders with more than 2 distinct line items require
 * a 50% advance payment via UddoktaPay. The remaining balance is COD.
 *
 * Exemptions:
 * - In-store orders (payment_method === 'in_store') are always exempt.
 * - Full UddoktaPay (payment_method === 'uddoktapay') pays the full amount online.
 * - Partial prepay (payment_method === 'partial_prepay') is the retry path after
 *   a 402 — the customer pays the 50% advance online, balance on delivery.
 *
 * All amounts are INTEGER paisa. No floating-point arithmetic.
 */

export const PREPAYMENT_ITEM_THRESHOLD = 2;
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
 * @param distinctItemCount Number of distinct line items (rows), NOT sum of quantities.
 * @param totalPaisa The server-computed total (subtotal + delivery - discount).
 * @param paymentMethod The payment method selected.
 */
export function calculatePrepayment(
  distinctItemCount: number,
  totalPaisa: number,
  paymentMethod: string
): PrepaymentDecision {
  // In-store orders are exempt
  if (paymentMethod === 'in_store') {
    return { required: false, advancePaisa: 0, balancePaisa: 0, message: null };
  }

  // If customer already chose full UddoktaPay, no split needed — full amount is paid online
  if (paymentMethod === 'uddoktapay') {
    return { required: false, advancePaisa: totalPaisa, balancePaisa: 0, message: null };
  }

  // Partial prepay: customer is paying the advance portion via UddoktaPay.
  // Computes the same 50% split but does not require further prepayment.
  if (paymentMethod === 'partial_prepay') {
    const advancePaisa = (totalPaisa + 1) >> 1;
    const balancePaisa = totalPaisa - advancePaisa;
    return { required: false, advancePaisa, balancePaisa, message: null };
  }

  // COD with ≤2 items: no prepayment needed
  if (distinctItemCount <= PREPAYMENT_ITEM_THRESHOLD) {
    return { required: false, advancePaisa: 0, balancePaisa: totalPaisa, message: null };
  }

  // COD with >2 items: 50% advance required
  // ceil(totalPaisa / 2) using integer math: (totalPaisa + 1) >> 1
  const advancePaisa = (totalPaisa + 1) >> 1;
  const balancePaisa = totalPaisa - advancePaisa;

  return {
    required: true,
    advancePaisa,
    balancePaisa,
    message: PREPAYMENT_MESSAGE
  };
}
