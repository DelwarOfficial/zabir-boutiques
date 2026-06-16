# Logpush Configuration [Master_Prompt v7.0 §6.1, G9]

This document describes the Cloudflare Logpush job that ships all Worker logs to R2.

## Configuration

- **Destination:** R2 bucket `zabir-logs`
- **Dataset:** Workers (all fields)
- **Filter:** Apply the following PII-scrubbing transform before persistence
  (defense in depth — the app already scrubs via `src/lib/pii-scrubber.ts`):
  - Replace any field matching `phone` with `[PHONE]`
  - Replace any field matching `email` with `[EMAIL]`
  - Replace any field matching `address` with `[REDACTED]`
  - Drop the `Cookie` header entirely
  - Drop the `Authorization` header entirely
  - Drop any `cf-connecting-ip` and `x-forwarded-for` fields (kept in PII-aware D1 audit only)
- **Format:** JSON
- **Frequency:** Every 30 seconds
- **Retention:** 90 days in R2 Standard, 1 year in R2 Infrequent Access (lifecycle rule)

## Cloudflare dashboard steps

1. Workers & Pages → `zabir-boutiques` → Logs → Logpush
2. Create job
3. Destination: R2 → bucket `zabir-logs`
4. Dataset: Workers
5. Add the field redactions above
6. Enable and test

## Verifying the scrubber is working

After deployment, `wrangler tail` a known PII-emitting request and confirm the
output is structured JSON without `phone`, `address`, or `email` fields.
The local `safeLog` helper in `src/lib/pii-scrubber.ts` is the same logic
Logpush will run server-side, so any scrubber regression surfaces in CI.
