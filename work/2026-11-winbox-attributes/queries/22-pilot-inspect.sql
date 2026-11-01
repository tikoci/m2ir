-- 22-pilot-inspect: inspect-derived nodes under the pilot menu paths,
-- one row per (node, presence version). Exact-or-prefix matching avoids
-- colliding with longer sibling paths such as /ip/address-list.
SELECT sn.path, sn.name, sn.type, sn.parent_path, sn.data_type,
       sn.type_tag, sn.enum_values, p.version AS presence_version
FROM schema_nodes sn
LEFT JOIN schema_node_presence p ON p.node_id = sn.id
WHERE sn.path = '/ip/address' OR sn.path LIKE '/ip/address/%'
   OR sn.path = '/system/identity' OR sn.path LIKE '/system/identity/%'
ORDER BY sn.path, p.version;
