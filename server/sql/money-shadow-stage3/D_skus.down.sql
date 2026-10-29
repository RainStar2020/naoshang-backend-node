-- DDL auto-commits; preserve values, restore nullable columns.
ALTER TABLE `skus` DROP CHECK `ck_s3_skus`;
ALTER TABLE `skus` MODIFY COLUMN `list_price_cents` BIGINT NULL, MODIFY COLUMN `currency` CHAR(3) NULL;
