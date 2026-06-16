-- Zabir Boutiques v7.0 — FTS5 Product Search
-- Per Master_Prompt v7.0 §13.1, Phase 1 search uses SQLite FTS5 for
-- tokenized full-text search with relevance ranking and prefix
-- matching for autocomplete.

CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
  name,
  description,
  category,
  tags,
  content='products',
  content_rowid='rowid',
  tokenize="porter unicode61"
);

-- Triggers to keep the FTS table in sync with products.
CREATE TRIGGER IF NOT EXISTS products_fts_ai AFTER INSERT ON products BEGIN
  INSERT INTO products_fts(rowid, name, description, category, tags)
  VALUES (new.rowid, new.name, COALESCE(new.description, ''), new.category_id, '');
END;

CREATE TRIGGER IF NOT EXISTS products_fts_ad AFTER DELETE ON products BEGIN
  INSERT INTO products_fts(products_fts, rowid, name, description, category, tags)
  VALUES ('delete', old.rowid, old.name, COALESCE(old.description, ''), old.category_id, '');
END;

CREATE TRIGGER IF NOT EXISTS products_fts_au AFTER UPDATE ON products BEGIN
  INSERT INTO products_fts(products_fts, rowid, name, description, category, tags)
  VALUES ('delete', old.rowid, old.name, COALESCE(old.description, ''), old.category_id, '');
  INSERT INTO products_fts(rowid, name, description, category, tags)
  VALUES (new.rowid, new.name, COALESCE(new.description, ''), new.category_id, '');
END;

-- Backfill: populate FTS for any existing products.
INSERT INTO products_fts(rowid, name, description, category, tags)
SELECT rowid, name, COALESCE(description, ''), category_id, ''
FROM products
WHERE rowid NOT IN (SELECT rowid FROM products_fts);

INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES ('0012_fts5_search', '2026-06-09 00:00:00');
