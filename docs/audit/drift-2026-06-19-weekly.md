# Drift Audit — 2026-06-19 — scope: weekly

- Total findings: 2
- P0 (blocks merge): 1
- P1 (fix before next release): 1
- P2 (fix in normal workflow): 0
- P3 (informational): 0

## P0 findings

- [D-35] db/migrations/0029_*.sql — Migration is missing a matching rollback file.
  - Fix: Add rollback files for every migration. See Section 38.2 D-35.

## P1 findings

- [D-03] src/pages/staff/settings/totp.astro — Static route missing `export const prerender = true`.
  - Fix: Add `export const prerender = true` to the static route. See Section 38.2 D-03.

## P2 findings

(none)

## P3 findings

(none)
