-- Rollback: Remove seeded site_settings
DELETE FROM site_settings WHERE key IN (
  'store.name',
  'store.tagline',
  'store.address',
  'store.phone',
  'store.email',
  'store.logo',
  'store.social_facebook',
  'store.social_instagram',
  'delivery_inside_dhaka_paisa',
  'delivery_outside_dhaka_paisa'
);
