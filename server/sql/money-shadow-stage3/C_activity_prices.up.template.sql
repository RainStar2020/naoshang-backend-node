-- GUARDED TEMPLATE ONLY, NOT AN APPROVED APPLY SCRIPT. No literal amounts generated.
-- REQUIRE table backup/snapshot + isolated-copy rehearsal + separately approved parameter bindings.
-- Obtain @expected_mysql_fingerprint from this exact expression in a frozen snapshot.
-- JSON plan fingerprint is different and must NOT be substituted for MySQL fingerprint.
SELECT `product_id`, SHA2(CAST(JSON_ARRAY(CAST(`product_id` AS CHAR),CAST(`amount` AS CHAR),CAST(`activity_price_cents` AS CHAR),CAST(`currency` AS CHAR)) AS CHAR),256) AS migration_fingerprint FROM `activity_prices` WHERE 1=1;
START TRANSACTION;
UPDATE `activity_prices` SET `activity_price_cents`=@new_activity_price_cents, `currency`=@new_currency
WHERE `product_id`=@record_id AND SHA2(CAST(JSON_ARRAY(CAST(`product_id` AS CHAR),CAST(`amount` AS CHAR),CAST(`activity_price_cents` AS CHAR),CAST(`currency` AS CHAR)) AS CHAR),256)=@expected_mysql_fingerprint AND @new_currency='CNY' AND @new_activity_price_cents BETWEEN 0 AND 9007199254740991;
SELECT ROW_COUNT() AS affected_rows; -- must be exactly 1; otherwise stop
ROLLBACK; -- rehearsal default; COMMIT requires a separately reviewed rendered batch
