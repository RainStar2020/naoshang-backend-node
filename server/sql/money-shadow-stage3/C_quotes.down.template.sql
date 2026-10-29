-- GUARDED TEMPLATE ONLY, NOT AN APPROVED APPLY SCRIPT. No literal amounts generated.
-- REQUIRE table backup/snapshot + isolated-copy rehearsal + separately approved parameter bindings.
-- Obtain @expected_mysql_fingerprint from this exact expression in a frozen snapshot.
-- JSON plan fingerprint is different and must NOT be substituted for MySQL fingerprint.
SELECT `id`, SHA2(CAST(JSON_ARRAY(CAST(`id` AS CHAR),CAST(`amount` AS CHAR),CAST(`breakdown` AS CHAR),CAST(`scene` AS CHAR),CAST(`payable_amount_cents` AS CHAR),CAST(`goods_amount_cents` AS CHAR),CAST(`discount_amount_cents` AS CHAR),CAST(`list_amount_cents` AS CHAR),CAST(`currency` AS CHAR)) AS CHAR),256) AS migration_fingerprint FROM `quotes` WHERE 1=1 AND `scene`='checkout';
START TRANSACTION;
UPDATE `quotes` SET `payable_amount_cents`=@previous_payable_amount_cents, `goods_amount_cents`=@previous_goods_amount_cents, `discount_amount_cents`=@previous_discount_amount_cents, `list_amount_cents`=@previous_list_amount_cents, `currency`=@previous_currency
WHERE `id`=@record_id AND SHA2(CAST(JSON_ARRAY(CAST(`id` AS CHAR),CAST(`amount` AS CHAR),CAST(`breakdown` AS CHAR),CAST(`scene` AS CHAR),CAST(`payable_amount_cents` AS CHAR),CAST(`goods_amount_cents` AS CHAR),CAST(`discount_amount_cents` AS CHAR),CAST(`list_amount_cents` AS CHAR),CAST(`currency` AS CHAR)) AS CHAR),256)=@expected_post_migration_fingerprint AND `scene`='checkout';
SELECT ROW_COUNT() AS affected_rows; -- must be exactly 1; otherwise stop
ROLLBACK; -- uses saved preimages, NEVER recompute from yuan values
