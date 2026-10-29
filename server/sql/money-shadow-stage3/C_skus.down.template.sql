-- GUARDED TEMPLATE ONLY, NOT AN APPROVED APPLY SCRIPT. No literal amounts generated.
-- REQUIRE table backup/snapshot + isolated-copy rehearsal + separately approved parameter bindings.
-- Obtain @expected_mysql_fingerprint from this exact expression in a frozen snapshot.
-- JSON plan fingerprint is different and must NOT be substituted for MySQL fingerprint.
SELECT `id`, SHA2(CAST(JSON_ARRAY(CAST(`id` AS CHAR),CAST(`list_price` AS CHAR),CAST(`list_price_cents` AS CHAR),CAST(`currency` AS CHAR)) AS CHAR),256) AS migration_fingerprint FROM `skus` WHERE 1=1;
START TRANSACTION;
UPDATE `skus` SET `list_price_cents`=@previous_list_price_cents, `currency`=@previous_currency
WHERE `id`=@record_id AND SHA2(CAST(JSON_ARRAY(CAST(`id` AS CHAR),CAST(`list_price` AS CHAR),CAST(`list_price_cents` AS CHAR),CAST(`currency` AS CHAR)) AS CHAR),256)=@expected_post_migration_fingerprint;
SELECT ROW_COUNT() AS affected_rows; -- must be exactly 1; otherwise stop
ROLLBACK; -- uses saved preimages, NEVER recompute from yuan values
