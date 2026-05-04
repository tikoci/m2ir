# profiles/winbox-ipc/

RouterOS IPC over TCP/8291 — the WinBox app's wire conversation with a
router. Same `nv::message` grammar as `dude-on-disk/` and `winbox-cdb/`;
this profile names byte 2 as `namespace` (0xFF=system, 0xFE=session,
0x00=user) and uses the low bit of the tcode to signal compact length.

The seed material (a Kaitai schema for the chunk frame, the M2 TLV grammar,
the EC-SRP5 handshake, and a YAML semantic overlay) is preserved in
`strawman/` as the input to the v0.1 redesign. None of those files are
canonical m2ir form yet — they are the evidence the new YAML schema is
being derived against. See `/DESIGN.md` for what canonical looks like.
