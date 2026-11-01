-- cspell:ignore cliref
-- 23-pilot-entry-links: CLI-reference entry to inspect-node links for the
-- pilot menus. One property can join to arguments under multiple verbs
-- (see query 24); an exact link here only ties the menu, not the field.
SELECT p.manual_version, e.source_path, sn.path AS schema_path,
       el.match_kind, el.match_detail
FROM cliref_entries e
JOIN cliref_entry_schema_links el ON el.entry_id = e.id
JOIN schema_nodes sn ON sn.id = el.schema_node_id
JOIN cliref_pages p ON p.id = e.page_id
WHERE p.manual_version IN ('7.24', '7.25', '7.26')
  AND e.source_path IN ('ip/address', 'system/identity')
ORDER BY p.manual_version, e.source_path;
