-- Archive shadow columns first. Prefer flags-off rollback; never drop old yuan columns.
-- REQUIRE snapshot verification and explicit approval. DDL is not transactional.
ALTER TABLE `columns`
  DROP COLUMN `price_cents`,
  DROP COLUMN `currency`;
