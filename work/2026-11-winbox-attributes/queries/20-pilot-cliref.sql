-- cspell:ignore cliref syscap unsettable iface
-- 20-pilot-cliref: pilot-menu CLI-reference candidates across all pinned
-- manual versions. Concise facts only: no description_markdown prose is
-- exported (see description_chars + url/source_line citation instead), so
-- this output stays citable without copying bulk vendor prose.
SELECT p.manual_version, p.slug, p.url, p.source_sha256,
       e.source_path, e.source_type, e.package, e.conditions,
       e.syscap AS entry_syscap,
       e.source_line AS entry_line,
       e.source_end_line AS entry_end_line,
       f.name, f.raw_type, f.field_kind, f.mandatory,
       f.unsettable, f.syscap AS field_syscap,
       f.source_order, f.source_line,
       length(f.description_markdown) AS description_chars
FROM cliref_fields f
JOIN cliref_entries e ON e.id = f.entry_id
JOIN cliref_pages p ON p.id = e.page_id
WHERE p.manual_version IN ('7.24', '7.25', '7.26')
  AND e.source_path IN ('ip/address', 'system/identity')
ORDER BY p.manual_version, e.source_path, f.source_order;
