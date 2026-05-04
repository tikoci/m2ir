# profiles/

One subdirectory per *usage context* of a shared physical wire format. A
profile names bytes 2–3 according to local convention, picks how compact-
length is signaled, and binds tags to fields. The same `nv::message`
("M2") grammar appears in several profiles below; MNDP is a separate
grammar but conveys the same concepts (see `/concepts/`).

| Profile | Status | Reference impl |
|---|---|---|
| `winbox-ipc/` | strawman drained into canonical YAML | this repo's parent project + Cisco-Talos dissector |
| `dude-on-disk/` | placeholder | [`tikoci/donny`](https://github.com/tikoci/donny) + [`german77/TheDudeToHuman`](https://github.com/german77/TheDudeToHuman) |
| `winbox-cdb/` | placeholder | `~/Lab/centrs` `src/data/winbox-cdb.ts` |
| `mndp/` | placeholder | `~/Lab/mcp-monorepo/mcp-mikrotik` `src/mndp.ts` |

A profile is one directory of YAML; prose lives inside the schema (in
`notes:`, `evidence:`, `revision-history:`, …), not in adjacent `.md`
spec files. See `/DESIGN.md` for the layering rationale.
