-- Migration: orders.cod_collected_paisa [Master Plan V8 F-03, T-24]
-- Records COD cash actually collected by the courier on delivery, distinct
-- from courier handoff (which only records that a parcel left the shop).
-- NULL until delivery is confirmed.

ALTER TABLE orders ADD COLUMN cod_collected_paisa INTEGER;
