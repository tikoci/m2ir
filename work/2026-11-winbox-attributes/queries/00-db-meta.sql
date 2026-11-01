-- cspell:ignore cliref
-- 00-db-meta: database provenance. The extractor fails closed when these
-- differ from EXPECTED_PROVENANCE in rosetta-extract.ts.
SELECT key, value FROM db_meta ORDER BY key;
