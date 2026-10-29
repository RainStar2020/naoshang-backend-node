-- GUARDED TEMPLATE ONLY, NOT AN APPROVED APPLY SCRIPT. No literal amounts generated.
-- REQUIRE table backup/snapshot + isolated-copy rehearsal + separately approved parameter bindings.
-- Obtain @expected_mysql_fingerprint from this exact expression in a frozen snapshot.
-- JSON plan fingerprint is different and must NOT be substituted for MySQL fingerprint.
SELECT `id`, SHA2(CAST(JSON_ARRAY(CAST(`id` AS CHAR),CAST(`amount` AS CHAR),CAST(`breakdown` AS CHAR),CAST(`scene` AS CHAR),CAST(`payable_amount_cents` AS CHAR),CAST(`goods_amount_cents` AS CHAR),CAST(`discount_amount_cents` AS CHAR),CAST(`list_amount_cents` AS CHAR),CAST(`currency` AS CHAR)) AS CHAR),256) AS migration_fingerprint FROM `quotes` WHERE 1=1 AND `scene`='checkout';
START TRANSACTION;
UPDATE `quotes` SET `payable_amount_cents`=@new_payable_amount_cents, `goods_amount_cents`=@new_goods_amount_cents, `discount_amount_cents`=@new_discount_amount_cents, `list_amount_cents`=@new_list_amount_cents, `currency`=@new_currency
WHERE `id`=@record_id AND SHA2(CAST(JSON_ARRAY(CAST(`id` AS CHAR),CAST(`amount` AS CHAR),CAST(`breakdown` AS CHAR),CAST(`scene` AS CHAR),CAST(`payable_amount_cents` AS CHAR),CAST(`goods_amount_cents` AS CHAR),CAST(`discount_amount_cents` AS CHAR),CAST(`list_amount_cents` AS CHAR),CAST(`currency` AS CHAR)) AS CHAR),256)=@expected_mysql_fingerprint AND `scene`='checkout' AND @new_currency='CNY' AND @new_payable_amount_cents BETWEEN 0 AND 9007199254740991 AND (@new_goods_amount_cents IS NULL OR @new_goods_amount_cents BETWEEN 0 AND 9007199254740991) AND (@new_discount_amount_cents IS NULL OR @new_discount_amount_cents BETWEEN 0 AND 9007199254740991) AND (@new_list_amount_cents IS NULL OR @new_list_amount_cents BETWEEN 0 AND 9007199254740991);
SELECT ROW_COUNT() AS affected_rows; -- must be exactly 1; otherwise stop
ROLLBACK; -- rehearsal default; COMMIT requires a separately reviewed rendered batch
