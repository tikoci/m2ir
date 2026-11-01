-- 12-inspect-arg-counts: inspect-derived CLI argument rows per presence
-- version. Verbatim from attribute-discovery-plan.md. Expected:
-- 7.25=37240, 7.26beta4=37233.
SELECT p.version, count(*) AS args
FROM schema_node_presence p
JOIN schema_nodes s ON s.id = p.node_id
WHERE s.type = 'arg'
GROUP BY p.version;
