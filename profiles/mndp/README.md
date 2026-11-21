# profiles/mndp/

MikroTik Neighbor Discovery Protocol over UDP 5678. *Not* an `nv::message`
profile: MNDP has its own TLV grammar (big-endian `u16` type and length, no
marker or tcode byte). It belongs in m2ir anyway because it carries the
*same values* (RouterOS identity, version, board, MAC, IPv4/IPv6, uptime)
that turn up in the nv::message profiles. That's the empirical case for
`/concepts/`.

## Canonical YAML

- [`physical/mndp.yaml`](../../physical/mndp.yaml): the datagram grammar
  (4-byte header, TLV records to the exact end of the payload) and the
  value encodings.
- [`profile.yaml`](profile.yaml): the header counter, TLVs 1–19 with
  names, `/ip/neighbor` fields, encodings, byte order, lengths, enum and
  bitmask values, request packets, TLV order by version, and timing. Every
  entry carries its confidence, the RouterOS versions it was seen on, and
  evidence.

Start there; this README does not repeat the tables. The traps a decoder
hits first, each with its entry in `profile.yaml`:

- **Byte order is mixed.** TLV type and length are big-endian. Uptime
  (TLV 10) is little-endian on every CPU seen, MIPSBE included.
  Aggregated-size (TLV 9) is little-endian on x86_64 and unverified on
  every other architecture, 32-bit x86 included. The header counter is in the *sender's* byte order.
- **TLV 14 is the IPv6-enabled flag**, not `unpack`; what it means
  depends on the sender's version. `unpack=` comes from TLVs 2–4.
- **A request** must first pass the framing rule: its TLVs end exactly at
  the end of the datagram. Then it is a request if the header is
  `00000000` or it carries an empty TLV 6 (a non-empty TLV 6 alone was not
  tested). No router answered any malformed form tested (trailing bytes,
  shorter than a header). Send `00 00 00 00 00 06 00 00`.

## Evidence

The grounding lab, its harness and the raw evidence stay in
[`work/2026-11-mndp-grounding/`](../../work/2026-11-mndp-grounding/README.md);
[`FINDINGS.md`](../../work/2026-11-mndp-grounding/FINDINGS.md) is the
long-form write-up the YAML was promoted from.
[`fixtures/mndp/`](../../fixtures/mndp/) holds slices of that evidence, and
[`test/profiles/mndp/`](../../test/profiles/mndp/mndp-profile.test.ts)
replays them against the YAML.

Public implementation references, inspected centrs main revision
`0221b899da70b8c54410f357fd77c2133b286c08`:

- [MNDP codec](https://github.com/tikoci/centrs/blob/0221b899da70b8c54410f357fd77c2133b286c08/src/data/mndp.ts)
- [Codec tests](https://github.com/tikoci/centrs/blob/0221b899da70b8c54410f357fd77c2133b286c08/test/unit/mndp.test.ts)

Earlier implementation lead: `mcp-mikrotik` `src/mndp.ts`. See also the
`routeros-mndp` skill for discovery-specific work. Those sources predate
the grounding and disagree with it in places (TLV 14, the header, request
bytes); `profile.yaml` records each correction under `revision-history`.

Use the [discovery submission path](../../README.md#submit-a-discovery) for
unknown TLVs, version differences, sanitized samples, or proposed mappings.
Open questions are listed at the end of `profile.yaml`; unidentified values
are tracked in [#3](https://github.com/tikoci/m2ir/issues/3). The
[format and research index](../README.md) routes other protocols.
