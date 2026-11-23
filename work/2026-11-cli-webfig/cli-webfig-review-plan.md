# CLI operations to WebFig review views

Status: proposed follow-on, 2026-11-22. This note parks an idea for a later
research session; no resolver or new browser validation is implemented here.
It reuses the declared-schema-first `.jg` research merged in
[#14](https://github.com/tikoci/m2ir/pull/14), without changing that track's
[plan](../2026-11-jg-descriptors/plan.md) or next steps.

## Question and intended use

Can an observed RouterOS CLI menu/property be resolved to the relevant
WebFig table or form through its native M2 identity?

The proposed join is:

`CLI menu + property -> M2 route + typed keys -> .jg dialog -> WebFig fragment`

A consumer such as centrs could use the result to offer a precise human
review link after an operation, or identify the view relevant to a future
MCP App. Returning a set of explained candidates is acceptable; choosing a
single view when the evidence is ambiguous is not.

## Starting evidence

The research snapshot is m2ir `70f725d` (merged #14). The
[undo report for 7.25](../2026-11-jg-descriptors/undo-oracle-mapping-7.25.md)
maps 257 CLI properties from 34 menus onto 30 routes by isolated writes,
with a [7.26beta4 report](../2026-11-jg-descriptors/undo-oracle-mapping-7.26beta4.md)
for comparison. These are write-oriented observations, not complete CLI or
read-only-menu coverage. The
[research findings](../2026-11-jg-descriptors/README.md) explain the method
and limitations.

The [.jg parser](../2026-11-jg-descriptors/jg-parse.ts) already retains
routes, typed field occurrences, dialog titles, and some conditions. It
does not retain the complete group/service/container ancestry needed to
generate fragments reliably. A global match on a title such as Settings
would lose essential context.

The routeros-webfig skill supplies the
[fragment grammar and structural catalog](https://github.com/tikoci/routeros-skills/blob/main/routeros-webfig/references/webfig-url-scheme.md)
and its [validation record](https://github.com/tikoci/routeros-skills/blob/main/routeros-webfig/references/validation.md).
Its baseline catalog is from 7.24.5; it is a source lead, not navigation
proof for the 7.25 corpus. For example, `/ip/dns cache-size` maps to
`[14,2]` / `u4` and the Settings dialog in the undo report; the catalog
suggests `#IP:DNS.Settings`. That final link remains a candidate until
checked against matching target assets and the rendered UI.

## Loose investigation sequence

1. Preserve the `.jg` menu hierarchy alongside each dialog and control,
   retaining inheritance, subtype selectors, package source and predicates.
   Inspect the matching WebFig fragment construction before generating URLs.
2. Join the existing undo mappings to those occurrences using the route,
   command/operation and typed keys. Start with the existing corpus, without
   widening the write campaign. Shared route `[20,17]` is a useful test:
   connection tracking, neighbor discovery, IPv6 settings and bridge settings
   use different fields and views on that same route.
3. Produce a small generated candidate artifact and an ambiguity report.
   Keep the CLI identity, route, typed keys, dialog ancestry, fragment,
   conditions and evidence together. Record the m2ir revision, RouterOS
   build, package set and descriptor identifiers. Separate observed CLI
   mappings, descriptor declarations and browser-verified navigation.
4. Verify a small allowlist of ordinary tables/forms on a disposable CHR.
   Confirm the rendered title and selected tab; an unchanged hash or HTTP
   success alone does not establish navigation. Record unresolved and absent
   views explicitly. Do not bulk-open descriptor entries: some action
   containers dispatch operations when opened.

Useful outcomes include multiple views for one property, fields without a
visible control, and routes without a CLI mapping. Hidden controls, hardware
predicates, policies and skins may prevent an otherwise plausible link from
being usable. Per-object suffixes need separate identity evidence; do not
assume a universal conversion from REST `.id` to a WebFig object suffix.

## Boundary and stopping point

The first research slice is done when it demonstrates a few explained joins,
including a shared-route case, reports ambiguity in the existing corpus and
records which candidates were actually opened on a matching build. It need
not cover every menu, publish a stable resolver API or implement an MCP App.

A fragment selects a view inside the full WebFig application; it is not a
server endpoint returning standalone dialog HTML. Partial rendering, session
hosting and embedding are separate consumer investigations. The
[skill's embedding guidance](https://github.com/tikoci/routeros-skills/blob/main/routeros-webfig/SKILL.md#embed-in-an-app)
records same-origin framing restrictions on tested builds. A navigation map
alone does not establish an embeddable WebFig panel.

Keep investigation tools and derived evidence here if this resumes; fetch
vendor assets into scratch rather than committing them. Promote supported
protocol relationships into canonical YAML when justified. Consumer UI and
hosting belong in the consuming project, and generated fragments should
reuse the source hierarchy rather than grow a second manual catalog.
