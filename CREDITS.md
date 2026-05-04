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
(three `.ksy` files plus the semantic-overlay `.yaml`) and the
`PROTOCOL.md` notes that drove the v0.1 strawman drain.

## Adding a new source

If you drain a substantial new source — a project repo, a research
paper, a vendor doc tree — add a section here. Per-page web citations
stay inside the schema's `evidence:` blocks; this page is a project-level
index, not an exhaustive bibliography. See
[`.github/instructions/credits-maintenance.instructions.md`](.github/instructions/credits-maintenance.instructions.md).
