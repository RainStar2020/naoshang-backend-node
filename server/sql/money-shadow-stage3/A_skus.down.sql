-- Archive shadow columns first. Prefer flags-off rollback; never drop old yuan columns.
-- REQUIRE snapshot verification and explicit approval. DDL is not transactional.
ALTER TABLE `skus`
  DROP COLUMN `list_price_cents`,
  DROP COLUMN `currency`;
