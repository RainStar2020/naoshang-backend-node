-- DDL auto-commits; preserve values, restore nullable columns.
ALTER TABLE `columns` DROP CHECK `ck_s3_columns`;
ALTER TABLE `columns` MODIFY COLUMN `price_cents` BIGINT NULL, MODIFY COLUMN `currency` CHAR(3) NULL;
