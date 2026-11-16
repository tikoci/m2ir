# profiles/mndp/

MikroTik Neighbor Discovery Protocol over UDP. *Not* an `nv::message`
profile — MNDP uses a different TLV grammar (BE u16 tag/length, no
marker/tcode byte). It belongs in m2ir anyway because it carries the
*same semantic values* (RouterOS identity, version, board model, MAC,
IPv4/v6, uptime) that turn up in the nv::message profiles. That's the
empirical case for `/concepts/`.

Byte order is mixed, and the old footgun note ("uptime is the only
little-endian integer") is incomplete. TLV type and length are big-endian
`u16`. Uptime (TLV 10) is a little-endian `u32` on every CPU seen,
including MIPSBE. Aggregated-size (TLV 9) is a little-endian `u32` on x86
and unverified on big-endian CPUs. The header counter uses the *sender's*
native byte order. See the [grounded wire map](#grounded-wire-map).

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

## Grounded wire map

The wire map grounded on 2026-11-15 (header, TLVs 1–19, layout by version,
timing and lifecycle), with requests and per-version TLV 14 added on
2026-11-16, lives with its evidence in
[`work/2026-11-mndp-grounding/FINDINGS.md`](../../work/2026-11-mndp-grounding/FINDINGS.md)
until canonical MNDP YAML exists. Its corrections to earlier sources:

- **TLV 14 is the IPv6-enabled flag**, not `unpack`. `unpack` comes from
  empty TLVs 2–4, and TLV 9 carries `aggregated-size`. Before 7.18 the flag
  means "IPv6 present". It follows `disable-ipv6` from 7.18, but on 7.18.2
  and 7.20.8 only after a reboot; 7.26beta5 follows it at once (7.21's
  changelog fix is the likely boundary, untested).
- **The header is a `u32` announcement counter** in the sender's CPU byte
  order, not version + TTL + sequence bytes.
- **TLV 18** (`running`, 7.20+) is a bitmask: `01` CAPsMAN, `02` CMR
  controller, `03` both (printed `capsman,cmr`).
- **A request** is a header of `00000000` or any packet carrying TLV 6. A
  packet with trailing bytes is dropped, so the "9-byte" forms (nine zero
  bytes, or TLV 6 plus a pad byte) draw no reply. Use
  `00 00 00 00 00 06 00 00`: it draws a reply without adding the requester
  to 7.x routers' neighbor tables. Replies are broadcast announcements to
  port 5678, sent after a random delay of up to about 2 s.
- **TLV 19** (7.24+) is the entry TTL in seconds,
  `min(discover-interval × 4 + 1, 255)`; `00` is the dying gasp.
- **TLV 15 repeats** once per IPv6 address on the interface.
