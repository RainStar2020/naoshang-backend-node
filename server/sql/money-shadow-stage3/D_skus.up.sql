-- Only after post-backfill zero blocking differences including MISSING_SHADOW.
-- Verify server CHECK enforcement/version; preflight require-complete and writer compatibility.
ALTER TABLE `skus`
  MODIFY COLUMN `list_price_cents` BIGINT NOT NULL,
  MODIFY COLUMN `currency` CHAR(3) NOT NULL DEFAULT 'CNY',
  ADD CONSTRAINT `ck_s3_skus` CHECK ((`list_price_cents` BETWEEN 0 AND 9007199254740991) AND `currency`='CNY');
