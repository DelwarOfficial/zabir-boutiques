# DO Refactor Tasks

## 1. Create D1 Migration File

Create D1 migration with 3 new tables (guest_carts, checkout_sessions, provider_health).

---

## 2. Update `src/lib/do-client.ts`

*Depends on: 1*

Remove DO types/helpers for CartDO, DirectCheckoutSessionDO, ProviderHealthDO. Add D1 equivalents.

---

## 3. Update `src/pages/api/cart/index.ts`

*Depends on: 2*

Replace CartDO with D1 + KV.

---

## 4. Update `src/pages/api/checkout.ts`

*Depends on: 2*

Replace CartDO load with D1.

---

## 5. Update `src/pages/api/buy-now/session.ts`

*Depends on: 2*

Replace DirectCheckoutSessionDO creation with D1.

---

## 6. Update `src/pages/api/buy-now/submit.ts`

*Depends on: 2*

Replace DirectCheckoutSessionDO load with D1.

---

## 7. Update Provider Health in `src/lib/do-client.ts` (Part 2)

*Depends on: 2*

Update provider health circuit breaker to use D1 instead of DO.

---

## 8. Update Integration Clients (Turnstile, Tinify, Payments, Fraud)

*Depends on: 7*

Ensure integration clients work with new D1-based provider health.

---

## 9. Add Cleanup Cron Jobs

*Depends on: 1, 7*

Add scheduled cleanup for stale guest carts, checkout sessions, provider health.

---

## 10. Verify Integration Tests

*Depends on: 3, 4, 5, 6, 8, 9*

Run full checkout + payment flows to ensure no regressions.

---

## 11. Deploy to Staging

*Depends on: 10*

Deploy refactored code to staging environment.

---

## 12. Deploy to Production

*Depends on: 11*

Deploy refactored code to production environment.

