-- N-28: provider-side payment method (bkash, nagad, ...) from verify-payment.
-- Required by the refund API. Distinct from orders.payment_method, which is
-- our own COD/prepay classification.
ALTER TABLE payments ADD COLUMN provider_payment_method TEXT;
