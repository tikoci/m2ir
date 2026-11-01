-- 30-type-tag-samples: full schema_nodes.type_tag distribution. Every
-- value is a CLI enum type name (evidence for the negative finding that
-- no numeric WinBox wire tag lives in this column).
SELECT type_tag, count(*) AS nodes
FROM schema_nodes
WHERE type_tag IS NOT NULL
GROUP BY type_tag
ORDER BY type_tag;
