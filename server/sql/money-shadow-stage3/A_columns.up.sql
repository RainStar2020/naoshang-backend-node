-- DDL auto-commits. REQUIRE verified table backup/snapshot and isolated HTTP smoke PASS first.
ALTER TABLE `columns`
  ADD COLUMN `price_cents` BIGINT NULL,
  ADD COLUMN `currency` CHAR(3) NULL;
