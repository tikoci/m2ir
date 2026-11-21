# Credits

m2ir is reverse-engineered protocol knowledge that other people did the
hard work of recovering. The schema YAMLs cite specific files and line
ranges; this page lists the upstream projects those citations resolve
to. If you build on m2ir, build on these too.

For per-field provenance, follow the `evidence:` and `source-table:`
blocks in `physical/`, `concepts/`, and `profiles/<name>/` — they carry
the deep links.

## Primary sources

### [Cisco-Talos / Winbox_Protocol_Dissector](https://github.com/Cisco-Talos/Winbox_Protocol_Dissector)

Wireshark Lua dissector for the WinBox app protocol. Source of the five
canonical enumerations drained into `profiles/winbox-ipc/`:
`commandCode`, `typeCode`, `statusCode`, `errorCode`, and `typeIDCode`
(SYS_, STD_, and process-id catch-alls). License: BSD-3-Clause.

### [MarginResearch / mikrotik_authentication](https://github.com/MarginResearch/mikrotik_authentication) + ["Pulling MikroTik into the Limelight"](https://margin.re/2022/06/pulling-mikrotik-into-the-limelight/)

EC-SRP5 handshake reconstruction, HKDF magic strings, the SYS_POLICY
bitmask values (admin / GUI-max / super-admin), the `[13, 4]`
authentication path to `/nova/bin/user`, and the FoisHandler
identification on `www` handler 2.

### [Tenable / routeros](https://github.com/tenable/routeros)

RouterOS reverse-engineering corpus. Drained slices:

- `msg_re/parse_x3` — `/nova/etc/loader/system.x3` parsing that proves
  process ids are loader-assigned and version-scoped.
- `msg_re/find_handlers` — registered-handler enumeration per binary
  (e.g. `/nova/bin/user` handlers `[1..8]`).
- `poc/bytheway` — CVE-2018-14847 PoC; documents `/nova/bin/mproxy` at
  process id 2 in 6.30.1–6.42.x.
- `8291_honeypot` — handshake-layer behavior of WinBox connections.

### [tikoci / donny](https://github.com/tikoci/donny)

TypeScript decoder for The Dude `dude.db` `objs.obj` blobs. Source of
the entire `profiles/dude-on-disk/` TAG / RANGE catalog: object-class
ranges, per-class field tables, sentinel values, and the
"@deprecated"-style alias trail.

### [german77 / TheDudeToHuman](https://github.com/german77/TheDudeToHuman)

Older C++ Dude decoder. Cross-checked against donny for the
`dude-on-disk` profile; preserved older field-name spellings as aliases
where they diverge.

### [subixonfire / winbox-terminal-protocol](https://github.com/subixonfire/winbox-terminal-protocol)

Pure-Python WinBox terminal-protocol implementation. Source of the seed
material in [`profiles/winbox-ipc/strawman/`](profiles/winbox-ipc/strawman/)
(three `.ksy` files plus the semantic-overlay `.yaml`), the imported
notes in [`work/2026-05-m2ir-bootstrap/`](work/2026-05-m2ir-bootstrap/),
and the `PROTOCOL.md` notes that drove the v0.1 strawman drain. License:
MIT; both folders keep the upstream notice in their own `LICENSE`.

### [Wireshark MNDP dissector](https://github.com/wireshark/wireshark/blob/ffc784d8541ac6bfb038d2186195252603d1f602/epan/dissectors/packet-mndp.c)

Public TLV names behind `profiles/mndp/` (types 1, 5, 7, 8, 10, 11, 12,
and 14 to 17) and the big-endian TLV header in `physical/mndp.yaml`.
Only names and numbers were taken; the encodings, byte order, versions
and the TLV 14 correction come from m2ir's own MNDP grounding lab
(`work/2026-11-mndp-grounding/`). License: GPL-2.0-or-later.

### [haakonnessjoen / MAC-Telnet](https://github.com/haakonnessjoen/MAC-Telnet)

C MNDP sender and parser in `src/protocol.c` and `src/protocol.h`. Source
of the TLV names for types 1, 5, 7, 8, 10, 11, 12 and 16, the 4-byte
header struct (the superseded version/TTL/checksum reading), the
big-endian TLV header, and the little-endian uptime. Only names, numbers
and byte order were taken. License: GPL-2.0-or-later.

## Adding a new source

If you drain a substantial new source — a project repo, a research
paper, a vendor doc tree — add a section here. Per-page web citations
stay inside the schema's `evidence:` blocks; this page is a project-level
index, not an exhaustive bibliography. See
[`.github/instructions/credits-maintenance.instructions.md`](.github/instructions/credits-maintenance.instructions.md).
