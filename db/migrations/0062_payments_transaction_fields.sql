-- N-28: persist the fields UddoktaPay's refund API requires.
--
-- POST /api/refund-payment takes transaction_id, payment_method, amount,
-- product_name and reason -- NOT invoice_id. The existing refund code sent
-- invoice_id, so no refund could ever have succeeded. transaction_id and
-- payment_method are only ever returned by /api/verify-payment, so they must
-- be captured at verification time or they are unrecoverable later.
ALTER TABLE payments ADD COLUMN transaction_id TEXT;
