-- DDL auto-commits; preserve values, restore nullable columns.
ALTER TABLE `activity_prices` DROP CHECK `ck_s3_activity_prices`;
ALTER TABLE `activity_prices` MODIFY COLUMN `activity_price_cents` BIGINT NULL, MODIFY COLUMN `currency` CHAR(3) NULL;
