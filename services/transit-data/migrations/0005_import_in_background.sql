-- Up Migration
-- An import is registered before its archive is downloaded (a download may take minutes, longer
-- than a request may last): status `downloading`, without hash and storage key until it is stored.
ALTER TABLE transit.feed_versions
  ALTER COLUMN sha256 DROP NOT NULL,
  ALTER COLUMN storage_key DROP NOT NULL,
  DROP CONSTRAINT feed_versions_status,
  ADD CONSTRAINT feed_versions_status
    CHECK (status IN ('downloading','downloaded','staged','validated','active','archived','failed')),
  ADD CONSTRAINT feed_versions_stored
    CHECK (status IN ('downloading', 'failed') OR (sha256 IS NOT NULL AND storage_key IS NOT NULL));
COMMENT ON COLUMN transit.feed_versions.sha256 IS 'Hash of the zip; the same archive is never imported twice. NULL until it is downloaded.';
COMMENT ON COLUMN transit.feed_versions.storage_key IS 'Object-storage key of the original zip (raw layer). NULL until it is stored.';

CREATE OR REPLACE FUNCTION transit.tg_feed_version_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
       (OLD.status = 'downloading' AND NEW.status IN ('downloaded', 'failed'))
    OR (OLD.status = 'downloaded' AND NEW.status IN ('staged', 'failed'))
    OR (OLD.status = 'staged'     AND NEW.status IN ('validated', 'failed'))
    OR (OLD.status = 'validated'  AND NEW.status IN ('active', 'archived', 'failed'))
    OR (OLD.status = 'active'     AND NEW.status = 'archived')
  ) THEN
    RAISE EXCEPTION 'feed version %: illegal status change % -> %', OLD.feed_version_id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'active'   THEN NEW.activated_at := now(); END IF;
  IF NEW.status = 'archived' THEN NEW.archived_at  := now(); END IF;
  RETURN NEW;
END $$;

-- Down Migration
DELETE FROM transit.feed_versions WHERE sha256 IS NULL OR storage_key IS NULL;
CREATE OR REPLACE FUNCTION transit.tg_feed_version_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
       (OLD.status = 'downloaded' AND NEW.status IN ('staged', 'failed'))
    OR (OLD.status = 'staged'     AND NEW.status IN ('validated', 'failed'))
    OR (OLD.status = 'validated'  AND NEW.status IN ('active', 'archived', 'failed'))
    OR (OLD.status = 'active'     AND NEW.status = 'archived')
  ) THEN
    RAISE EXCEPTION 'feed version %: illegal status change % -> %', OLD.feed_version_id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'active'   THEN NEW.activated_at := now(); END IF;
  IF NEW.status = 'archived' THEN NEW.archived_at  := now(); END IF;
  RETURN NEW;
END $$;
ALTER TABLE transit.feed_versions
  DROP CONSTRAINT feed_versions_stored,
  DROP CONSTRAINT feed_versions_status,
  ADD CONSTRAINT feed_versions_status
    CHECK (status IN ('downloaded','staged','validated','active','archived','failed')),
  ALTER COLUMN storage_key SET NOT NULL,
  ALTER COLUMN sha256 SET NOT NULL;
COMMENT ON COLUMN transit.feed_versions.sha256 IS 'Hash of the zip; the same archive is never imported twice.';
COMMENT ON COLUMN transit.feed_versions.storage_key IS 'Object-storage key of the original zip (raw layer).';
