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

Public implementation references, inspected centrs main revision
`0221b899da70b8c54410f357fd77c2133b286c08`:

- [MNDP codec](https://github.com/tikoci/centrs/blob/0221b899da70b8c54410f357fd77c2133b286c08/src/data/mndp.ts)
- [Codec tests](https://github.com/tikoci/centrs/blob/0221b899da70b8c54410f357fd77c2133b286c08/test/unit/mndp.test.ts)

Earlier implementation lead: `mcp-mikrotik` `src/mndp.ts`. See also the
`routeros-mndp` skill for discovery-specific work.

This is a **placeholder**, without canonical MNDP YAML. The implementation
and tests provide external evidence, not a completed schema drain here.
Use the [discovery submission path](../../README.md#submit-a-discovery) for
unknown TLVs, version differences, sanitized samples, or proposed mappings.
The [format and research index](../README.md) routes other protocols.
