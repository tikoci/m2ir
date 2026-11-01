-- 13-presence-versions: which RouterOS versions carry detailed
-- inspect node presence. Expected exactly: 7.25, 7.26beta4.
SELECT DISTINCT version FROM schema_node_presence ORDER BY version;
