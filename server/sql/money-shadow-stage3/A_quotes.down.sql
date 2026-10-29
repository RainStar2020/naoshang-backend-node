-- Archive shadow columns first. Prefer flags-off rollback; never drop old yuan columns.
-- REQUIRE snapshot verification and explicit approval. DDL is not transactional.
ALTER TABLE `quotes`
  DROP COLUMN `payable_amount_cents`,
  DROP COLUMN `goods_amount_cents`,
  DROP COLUMN `discount_amount_cents`,
  DROP COLUMN `list_amount_cents`,
  DROP COLUMN `currency`;
