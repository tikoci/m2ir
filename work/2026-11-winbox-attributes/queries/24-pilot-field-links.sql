-- cspell:ignore cliref
-- 24-pilot-field-links: CLI-reference field to inspect-arg links for the
-- pilot menus. The underlying view excludes read-only argument rows, so
-- actual-interface and vrf intentionally have no rows here; that absence
-- is a view boundary, not proof of a missing native field.
SELECT p.manual_version, e.source_path, f.name AS field_name,
       sn.path AS inspect_arg_path
FROM cliref_field_inspect_links l
JOIN cliref_fields f ON f.id = l.field_id
JOIN cliref_entries e ON e.id = f.entry_id
JOIN cliref_pages p ON p.id = e.page_id
JOIN schema_nodes sn ON sn.id = l.schema_node_id
WHERE p.manual_version IN ('7.24', '7.25', '7.26')
  AND e.source_path IN ('ip/address', 'system/identity')
ORDER BY p.manual_version, e.source_path, f.source_order, sn.path;
