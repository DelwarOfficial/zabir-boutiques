-- Rollback for 0012_fts5_search.sql
-- Drops the FTS5 virtual table and its sync triggers. The
-- `products_fts` virtual table cannot have its content-rowid
-- association broken without first removing the triggers, so we
-- DROP TRIGGER before DROP TABLE.
DROP TRIGGER IF EXISTS products_fts_au;
DROP TRIGGER IF EXISTS products_fts_ad;
DROP TRIGGER IF EXISTS products_fts_ai;
DROP TABLE IF EXISTS products_fts;

DELETE FROM schema_migrations WHERE version = '0012_fts5_search';
