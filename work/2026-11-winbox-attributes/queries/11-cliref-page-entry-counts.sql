-- cspell:ignore cliref
-- 11-cliref-page-entry-counts: supplementary corpus dimensions per manual
-- version. Expected pages: 7.24=1053, 7.25=1056, 7.26=1109.
SELECT p.manual_version,
       count(DISTINCT p.id) AS pages,
       count(DISTINCT e.id) AS entries,
       count(f.id) AS fields
FROM cliref_pages p
LEFT JOIN cliref_entries e ON e.page_id = p.id
LEFT JOIN cliref_fields f ON f.entry_id = e.id
GROUP BY p.manual_version
ORDER BY p.manual_version;
