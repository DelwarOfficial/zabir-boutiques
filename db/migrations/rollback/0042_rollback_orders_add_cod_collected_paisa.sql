-- ROLLBACK_EXCEPTION: column cod_collected_paisa left in place; harmless and idempotent.
SELECT 1 WHERE 0;
