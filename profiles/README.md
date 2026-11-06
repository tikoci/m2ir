# profiles/

One subdirectory per *usage context* of a shared physical wire format. A
profile names bytes 2–3 according to local convention, picks how compact-
length is signaled, and binds tags to fields. The same `nv::message`
("M2") grammar appears in several profiles below; MNDP is a separate
grammar but conveys the same concepts (see `/concepts/`).

| Profile | Status | Reference impl |
|---|---|---|
| [`winbox-ipc/`](winbox-ipc/) | transport, authentication, session crypto, and selected management handlers; ongoing research | public sources + client/server analysis + live CHR probes; [implemented consumers and limits](winbox-ipc/README.md#existing-consumers-and-implementation-status) |
| [`dude-on-disk/`](dude-on-disk/) | initial TAG/RANGE catalog drained into canonical YAML | [`tikoci/donny`](https://github.com/tikoci/donny) + [`german77/TheDudeToHuman`](https://github.com/german77/TheDudeToHuman) |
| [`winbox-cdb/`](winbox-cdb/) | placeholder | [centrs CDB reader](https://github.com/tikoci/centrs/blob/0221b899da70b8c54410f357fd77c2133b286c08/src/data/winbox-cdb.ts) (external implementation, not a populated m2ir profile) |
| `mndp/` | placeholder | `mcp-mikrotik` `src/mndp.ts` |

A profile is one directory of YAML; prose lives inside the schema (in
`notes:`, `evidence:`, `revision-history:`, …), not in adjacent `.md`
spec files. See `/DESIGN.md` for the layering rationale.

Use the [agent reading map](../llms.txt) to choose capture decoding,
patched WinBox compatibility, or native-backend work. The profile directory
records coverage; an external implementation link does not establish that
its format is fully documented here.
