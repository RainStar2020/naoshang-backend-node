-- DDL auto-commits. REQUIRE verified table backup/snapshot and isolated HTTP smoke PASS first.
ALTER TABLE `quotes`
  ADD COLUMN `payable_amount_cents` BIGINT NULL,
  ADD COLUMN `goods_amount_cents` BIGINT NULL,
  ADD COLUMN `discount_amount_cents` BIGINT NULL,
  ADD COLUMN `list_amount_cents` BIGINT NULL,
  ADD COLUMN `currency` CHAR(3) NULL;
