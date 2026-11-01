-- cspell:ignore ddl fts
-- 31-table-ddl: CREATE TABLE text for every non-FTS table, so the
-- numeric-identity column audit is reproducible from this output alone.
SELECT name, sql FROM sqlite_master
WHERE type = 'table'
  AND name NOT LIKE '%_fts%'
  AND name NOT LIKE '%_fts_%'
  AND name != 'sqlite_sequence'
ORDER BY name;
