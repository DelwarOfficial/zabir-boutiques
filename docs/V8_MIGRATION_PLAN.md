# V8 Migration Plan — Zabir Boutiques

**Status:** Authoritative for what is actually applied. Supersedes the earlier draft of this file, which described a 32-migration set (`0040`–`0071`) for tax_rates, coupon_redemptions, a `stock_reservations` rebuild, etc. — none of that was built. Investigation during implementation (see `V8_IMPLEMENTATION_LOG.md`) found most of those "gaps" were already solved by different, already-correct mechanisms already in the codebase. The real migration set is smaller and covers different tables.
**Date:** 2026-08-08 (rewritten to match reality)

---

## Repository state

Real head: **`db/migrations/0047_create_goods_receipts.sql`**. Next free number: **`0048`**.

`0001`–`0039` predate this work. `0040`–`0047` are the eight migrations that came out of implementing T-06 through T-26 (see `V8_IMPLEMENTATION_LOG.md` for the full ticket list, including the ~18 tickets that turned out to need no migration at all).

| # | Slug | Delivers | Ticket / Finding |
|---|---|---|---|
| 0040 | `checkout_sessions_add_binding_hash` | `checkout_sessions.bindingHash` — D1-fallback path for Buy Now session binding | T-06/07, RT-005, S-02 |
| 0041 | `seed_site_settings_commerce_defaults` | 4 rows in the existing `site_settings` table: COD ceiling, phone/address velocity, return window | T-08/09, S-04, RV8-006 |
| 0042 | `orders_add_cod_collected_paisa` | `orders.cod_collected_paisa` | T-24, F-03 |
| 0043 | `create_courier_cod_remittance` | `courier_cod_remittance` table | T-24, F-03 |
| 0044 | `create_pos_cash_drawer_sessions` | `pos_cash_drawer_sessions` table | T-25, F-09 |
| 0045 | `create_suppliers` | `suppliers` table | T-26, RT-003 |
| 0046 | `create_purchase_orders` | `purchase_orders` table | T-26, RT-003 |
| 0047 | `create_goods_receipts` | `goods_receipts` table | T-26, RT-003 |

Every migration above ships as exactly one statement per `.sql` file with a matching `rollback/{NNNN}_rollback_{slug}.sql`, following the repository's real convention (see Rules below — this differs from the original draft of this document).

---

## Rules That Govern Every Migration Here

1. **One statement per file.** D1 migrations are not transactional. A two-statement file can half-apply and leave a schema the code does not expect.
2. **Numbering is against the repository, not against a document.** `NNNN` is exactly one greater than the highest number in `db/migrations/`.
3. **Every migration has two files** (corrected from an earlier draft of this document, which invented a `preflight/` directory the repository does not have):
   - `db/migrations/{NNNN}_{slug}.sql`
   - `db/migrations/rollback/{NNNN}_rollback_{slug}.sql`
   Where a pre-flight check is warranted, it is a comment block at the top of the forward file (see `0024_stock_reservations_unique_constraint.sql` for the repository's own precedent), not a separate file.
4. **Risk is rated against a non-empty production database.** This is a live system with rows in every table touched.
5. **Never edit an applied migration.** Supersede it with a new one.
6. Money is integer paisa in every column added here.

### Risk classes

| Class | Meaning | Soak |
|---|---|---|
| Low | Additive, no FK into live data, no uniqueness added over existing rows | None |
| Medium | Adds a constraint or FK evaluated against existing rows, or removes protection | 24h staging |
| High | Adds uniqueness over an existing populated column, where existing duplicates would abort the apply | 24h staging + Owner sign-off |

### Dependency order

```
0040 ─── independent
0041 ─── independent
0042 ──► 0043            (courier_cod_remittance's expected_paisa reads orders.cod_collected_paisa)
0044 ─── independent
0045 ──► 0046 ──► 0047   (suppliers before purchase_orders before goods_receipts, via FK)
```

No migration in this set requires a maintenance window — all are additive (new columns/tables), none touch existing constraints on populated data.

---

## Risk Summary Against a Non-Empty Production Database

| Migration | Risk | Why |
|---|---|---|
| 0040 | Low | Additive nullable column on `checkout_sessions`, a table with no production traffic yet (D1-fallback path only used when `DIRECT_CHECKOUT_DO` is unbound) |
| 0041 | Low | `INSERT OR IGNORE` seed rows into an existing, already-populated `site_settings` table; cannot collide (new keys) |
| 0042 | Low | Additive nullable column on `orders`; existing rows read as NULL, which the `deliver.ts` route treats as "not yet captured" |
| 0043 | Low | New table, no FK into `orders` (courier/period are free text, not referential) |
| 0044 | Low | New table, `is_active`-style partial index only |
| 0045 | Low | New table |
| 0046 | Low | New table with FK to `suppliers` — safe, `suppliers` is created in the same batch of migrations and starts empty |
| 0047 | Low | New table with FK to `purchase_orders` and `product_variants`; `UNIQUE(adjustment_id)` is over a new empty table, not a populated one |

All eight are Low risk. None require a 24h soak or Owner sign-off under the risk classes above.

---

## Apply Procedure

Standard `wrangler d1 migrations apply` flow via `scripts/apply-migrations.ts` (`npm run db:migrate:local` / `db:migrate:prod`), which discovers `db/migrations/*.sql` by filename, sorts lexically, applies in order. No special handling needed for `0040`–`0047` — apply as a normal batch.

## Failure Recovery

Standard recovery: since every migration here is a single statement, a failure either applied or it did not — no half-applied state to reason about. Roll back via the matching `rollback/{NNNN}_rollback_{slug}.sql` file.

---

For the full record of what was checked, what turned out to be a non-issue, and what code (not just schema) changed alongside these migrations, see `V8_IMPLEMENTATION_LOG.md`.
