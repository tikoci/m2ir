-- cspell:ignore cliref
-- 21-pilot-standard: shared standard arguments deliberately omitted from
-- menu pages (comment, disabled, copy-from, place-before, print
-- modifiers, address flags). Applies to pilot menus alongside query 20.
SELECT manual_version, section, name, source_order, source_line,
       length(description_markdown) AS description_chars
FROM cliref_standard
WHERE manual_version IN ('7.24', '7.25', '7.26')
ORDER BY manual_version, section, source_order;
