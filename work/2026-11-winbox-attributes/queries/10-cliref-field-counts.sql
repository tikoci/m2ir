-- cspell:ignore cliref
-- 10-cliref-field-counts: CLI-reference field rows per manual version.
-- Verbatim from attribute-discovery-plan.md section "Local Rosetta
-- inspection". Expected: 7.24=10758, 7.25=10833, 7.26=11284.
SELECT p.manual_version, count(*) AS fields
FROM cliref_fields f
JOIN cliref_entries e ON e.id = f.entry_id
JOIN cliref_pages p ON p.id = e.page_id
GROUP BY p.manual_version;
