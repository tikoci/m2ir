# Format and research index

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
| [`mndp/`](mndp/) | placeholder; separate TLV grammar, no canonical MNDP YAML yet | [centrs codec](https://github.com/tikoci/centrs/blob/0221b899da70b8c54410f357fd77c2133b286c08/src/data/mndp.ts) and [tests](https://github.com/tikoci/centrs/blob/0221b899da70b8c54410f357fd77c2133b286c08/test/unit/mndp.test.ts); external implementation evidence |

A profile is one directory of YAML; prose lives inside the schema (in
`notes:`, `evidence:`, `revision-history:`, …), not in adjacent `.md`
spec files. See [DESIGN.md](../DESIGN.md) for the layering rationale.

Use the [agent reading map](../llms.txt) to choose capture decoding,
patched WinBox compatibility, or native-backend work, or start with another
format below. Those three tasks are examples. An external implementation
link does not establish that its format is fully documented here.

## File-based formats

| Task or artifact | Reading route | Boundary |
|---|---|---|
| The Dude `dude.db` object blobs | [Profile](dude-on-disk/profile.yaml) → [object classes](dude-on-disk/object-classes.yaml) → [fields](dude-on-disk/fields.yaml); follow their evidence to donny and TheDudeToHuman | Initial populated schema, not a complete database specification; tags depend on object class and marker rules |
| WinBox CDB saved connections | [CDB guide](winbox-cdb/README.md) → pinned centrs reader and tests linked there | Placeholder m2ir profile; external code is not canonical YAML |
| WBX saved sessions and WBX/CDB conversion | [Source inventory](../work/2026-05-winbox-nova-sources/winbox-nova-source-inventory.md), especially the converter and WBX-tools leads | Dated public-source scouting; no canonical WBX grammar here |
| RouterOS `.x3` metadata and image extraction | [CHR extraction notes](../work/2026-10-chr-extraction/README.md) → [experimental decoder](../work/2026-10-chr-extraction/x3parse.ts) | Version-scoped research and tooling; no standalone `.x3` profile |
| RouterOS `/rw/store/cfg.*` persistence | [SYS_OWNER](winbox-ipc/sys-keys.yaml) (`0xff001e`) → [live findings](../work/2026-10-chr-extraction/ws3c-prober-findings.md), especially store-forensics evidence | Selected native-write/store behavior, not a general store-file grammar |
| NPK, backups, user databases, supout, and other artifacts | [Source inventory](../work/2026-05-winbox-nova-sources/winbox-nova-source-inventory.md)'s extraction/tooling leads | Adjacent research sources only; no complete canonical profiles promised |

## Other protocols and shared mechanisms

- **MNDP discovery:** use the placeholder guide and external codec/tests
  above. MNDP has its own TLV grammar; WinBox's naming and compact rules do
  not transfer automatically.
- **MAC-Telnet and bandwidth test:** the WinBox guide's
  [implemented-consumer trail](winbox-ipc/README.md#existing-consumers-and-implementation-status)
  connects m2ir's EC-SRP5 findings to centrs' shared core and protocol
  consumers. This is shared authentication evidence, not complete m2ir
  profiles for either protocol.
- **RouterOS internal IPC, mproxy, and terminal access:** use the WinBox
  [profile](winbox-ipc/profile.yaml), [processes](winbox-ipc/processes.yaml),
  [mproxy seed](winbox-ipc/mproxy.yaml), and
  [private/legacy commands](winbox-ipc/commands.yaml). Follow version-scoped
  evidence for loader routing and the separately seeded terminal surface.
- **MAC-WinBox and RoMON:** follow the
  [source inventory](../work/2026-05-winbox-nova-sources/winbox-nova-source-inventory.md)
  for MAC-WinBox leads and the [CDB guide](winbox-cdb/README.md) for saved
  RoMON neighbor/target records. Saved-record structure does not prove a
  RoMON tunnel protocol; neither has a populated canonical profile here.

For a topic absent from this index, inspect the tracked
[`physical/`](../physical/), [`profiles/`](./), and [`work/`](../work/) trees,
then follow sources and evidence rather than assuming coverage. Report a
new lead or help with TLV mapping through the
[discovery submission path](../README.md#submit-a-discovery). Canonical
protocol detail belongs in YAML; this page maintains the routes to it.
