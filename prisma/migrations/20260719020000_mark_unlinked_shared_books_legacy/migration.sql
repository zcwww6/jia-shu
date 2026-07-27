-- Historical browser-authored snapshots have no persisted Book provenance and
-- must never remain eligible for the public token reader.
UPDATE "SharedBook" SET "legacySnapshot" = true WHERE "bookId" IS NULL AND "legacySnapshot" = false;
