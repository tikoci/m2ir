# profiles/mndp/

MikroTik Neighbor Discovery Protocol over UDP. *Not* an `nv::message`
profile — MNDP uses a different TLV grammar (BE u16 tag/length, no
marker/tcode byte). It belongs in m2ir anyway because it carries the
*same semantic values* (RouterOS identity, version, board model, MAC,
IPv4/v6, uptime) that turn up in the nv::message profiles. That's the
empirical case for `/concepts/`.

Footgun on record: MNDP uptime (tag 10) is the only little-endian
integer in the protocol — every other MNDP integer is big-endian.
Worth annotating prominently when the schema lands.

Reference implementation: `mcp-mikrotik` `src/mndp.ts`.
See also the `routeros-mndp` skill.

Placeholder.
