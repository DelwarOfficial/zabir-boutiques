DELETE FROM site_settings WHERE key IN (
  'commerce.max_cod_value_paisa',
  'commerce.cod_orders_per_phone_24h',
  'commerce.cod_orders_per_address_24h',
  'commerce.return_window_days'
);
