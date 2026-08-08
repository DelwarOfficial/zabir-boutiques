# Threat Model

## STRIDE Summary

| Asset | Main threats |
|---|---|
| D1 orders/payments | forged/replayed events, zero-amount races, unauthenticated status disclosure |
| Inventory DO/D1 | double accounting, stale reservations, missing reversal, restore divergence |
| Staff sessions | bot bypass, TOTP enrollment takeover, missing step-up, fail-open rate limits |
| Customer sessions | raw cart SID theft, URL leakage, body-selected session scope |
| Queues | lost fallback work, duplicate processing, undrained DLQs |
| Audit/logs | raw PII retention, incomplete chain verification, repudiation |
| POS invoices | serial collision/gaps from D1 read-modify-write |
| Provider accounts | open redirects, mock courier calls, weak webhook secondary controls |

## Top Attack Trees

1. Free goods: `POST /api/checkout` creates order before separate `advance_paisa` update; race payment processing against zero value. Impact: one order total, example BDT 25,000.
2. Payment metadata leak: enumerate `GET /api/payments/status/{uuid}`; successful guess returns amount, invoice, order ID. Impact: customer/payment confidentiality.
3. Payment confusion: unauthenticated `POST /api/payments/create` for known order ID with attacker redirect URL. Impact: phishing and provider-session churn.
4. Coupon depletion: send concurrent `POST /api/checkout/validate-coupon`/checkout requests with client-controlled subtotal. Impact: exhaust limited promotions or infer discount policy.
5. Owner takeover: stolen staff session, then `POST /api/staff/totp/verify` with attacker secret/code; stored secret becomes attacker-controlled. Impact: full business account control.
6. 2FA downgrade: stolen session calls `POST /api/staff/totp/disable` without recent step-up. Impact: persistent account weakening.
7. Fake shipment: authorized low-tier shipping user calls courier route with `{ "mock": true }` in production. Impact: false fulfilment evidence and customer loss.
8. Stock corruption: confirmed order decrements `stock` and increments `sold`; later correction compounds drift. Impact: oversell/undersell across full catalog.
9. Invoice collision: two cashiers concurrently run SELECT-next receipt generation. Impact: duplicate attempts/gaps and Mushak audit exposure.
10. Cart hijack: abandoned-cart email contains `/checkout?session_id=...`; leaked URL grants raw cart session identity. Impact: PII/cart manipulation.

Each tree is code-confirmed. Live provider/D1 PoCs were blocked by read-only scope.
