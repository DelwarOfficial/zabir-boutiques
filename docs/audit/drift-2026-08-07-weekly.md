# Drift Audit — 2026-08-07 — scope: weekly

- Total findings: 9
- P0 (blocks merge): 3
- P1 (fix before next release): 6
- P2 (fix in normal workflow): 0
- P3 (informational): 0

## P0 findings

- [D-35] db/migrations/0034_*.sql — Migration is missing a matching rollback file.
  - Fix: Add rollback files for every migration. See Section 38.2 D-35.
- [D-35] db/migrations/0035_*.sql — Migration is missing a matching rollback file.
  - Fix: Add rollback files for every migration. See Section 38.2 D-35.
- [D-35] db/migrations/0036_*.sql — Migration is missing a matching rollback file.
  - Fix: Add rollback files for every migration. See Section 38.2 D-35.

## P1 findings

- [D-03] src/pages/sitemap.xml.ts — Static route missing `export const prerender = true`.
  - Fix: Add `export const prerender = true` to the static route. See Section 38.2 D-03.
- [D-05] src/do/cart-do.ts — CartDO mutation path does not arm the 5-minute alarm.
  - Fix: Ensure every CartDO mutation arms the 5-minute alarm. See Section 38.2 D-05.
- [D-32] src/pages/api/staff/forgot-password.ts — Staff API route appears to be missing RBAC middleware.
  - Fix: Ensure staff routes have RBAC middleware and Cloudflare Access. See Section 38.2 D-32.
- [D-32] src/pages/api/staff/reset-password.ts — Staff API route appears to be missing RBAC middleware.
  - Fix: Ensure staff routes have RBAC middleware and Cloudflare Access. See Section 38.2 D-32.
- [D-41] src/pages/api/staff/orders/create.ts — Route handler directly mutates inventory_items without DO serialization.
  - Fix: Route stock mutations through VariantInventoryDO per Guardrail #36.
- [D-41] src/pages/api/staff/orders/[id]/confirm.ts — Route handler directly mutates inventory_items without DO serialization.
  - Fix: Route stock mutations through VariantInventoryDO per Guardrail #36.

## P2 findings

(none)

## P3 findings

(none)
