-- Table-level snapshot template; NEVER overwrite a previous backup.
-- Pause relevant writers/synchronizer while snapshotting; DDL cannot roll back.
-- Replace run identifier BEFORE review/execution; backup count/hash must be verified.
CREATE TABLE `stage3_c_RUNID_skus` LIKE `skus`;
INSERT INTO `stage3_c_RUNID_skus` SELECT * FROM `skus`;
CREATE TABLE `stage3_c_RUNID_activity_prices` LIKE `activity_prices`;
INSERT INTO `stage3_c_RUNID_activity_prices` SELECT * FROM `activity_prices`;
CREATE TABLE `stage3_c_RUNID_columns` LIKE `columns`;
INSERT INTO `stage3_c_RUNID_columns` SELECT * FROM `columns`;
CREATE TABLE `stage3_c_RUNID_quotes` LIKE `quotes`;
INSERT INTO `stage3_c_RUNID_quotes` SELECT * FROM `quotes`;
