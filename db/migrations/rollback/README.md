# Migration Rollbacks [Master_Prompt v7.0 §18.4, Phase 7.4]

When adding a new migration, drop a paired rollback file with the
same filename here. The runner expects `db/migrations/rollback/NNNN_*.sql`.

Rollback order is reverse-application. The runner also deletes
the matching `schema_migrations.version` row.

Examples:

- `0012_fts5_search.sql` → `0012_fts5_search.sql` (DROP TABLE
  products_fts; DROP TRIGGER products_fts_ai; DROP TRIGGER
  products_fts_ad; DROP TRIGGER products_fts_au;)
- `0011_master_prompt_v7_gaps.sql` → `0011_master_prompt_v7_gaps.sql`
  (drop all tables added in 0011 in reverse order; see the
  migration's footer for the exhaustive list.)
