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

## Lab observations: RouterOS 7.26beta5

The quickchr CMR wire study captured MNDP announcements from x86 CHRs on
QEMU socket links, across several lab runs (14 interface MACs). Each
router streamed its own links to the host with `/tool/sniffer` over TZSP
(2026-11-14, Linux KVM host). The figures below come from the 215 distinct
announcement payloads saved in its three evidence files. The tool saves a payload only when it differs from that
sender's previous one. Every value is a lab observation on this one build.
The table is a source for the MNDP YAML once it is written; it is not
canonical schema.

Sources, at quickchr main revision `dd7e0ad99aa51acc79f086fe5d71e65efbb511eb`
([tikoci/quickchr#277](https://github.com/tikoci/quickchr/pull/277)):

- [FINDINGS.md → Wire → MNDP](https://github.com/tikoci/quickchr/blob/dd7e0ad99aa51acc79f086fe5d71e65efbb511eb/examples/cmr/FINDINGS.md#mndp):
  claims, trial counts and method.
- [`wire.json`](https://github.com/tikoci/quickchr/blob/dd7e0ad99aa51acc79f086fe5d71e65efbb511eb/examples/cmr/evidence/7.26beta5/wire.json),
  [`wire-first-run.json`](https://github.com/tikoci/quickchr/blob/dd7e0ad99aa51acc79f086fe5d71e65efbb511eb/examples/cmr/evidence/7.26beta5/wire-first-run.json)
  and [`demo-probe-sniff.json`](https://github.com/tikoci/quickchr/blob/dd7e0ad99aa51acc79f086fe5d71e65efbb511eb/examples/cmr/evidence/7.26beta5/demo-probe-sniff.json):
  raw payloads in `wire.mndp[].payloadHex`.
- [TZSP/MNDP decoder](https://github.com/tikoci/quickchr/blob/dd7e0ad99aa51acc79f086fe5d71e65efbb511eb/examples/cmr/tool/tzsp.ts)
  and [tests](https://github.com/tikoci/quickchr/blob/dd7e0ad99aa51acc79f086fe5d71e65efbb511eb/test/unit/examples-cmr-tzsp.test.ts).
  The tests hold one CMR controller announcement as whole TZSP packets,
  captured before and after `/cmr set enabled=yes`.

### Header

| Bytes | Observed | Notes |
|---|---|---|
| 0 | Counter | Increments by 1 per announcement on an interface and restarts at boot. The IPv4 broadcast and IPv6 multicast copies of one announcement carry the same value. The highest value seen was `0x25`. A wider field would read the same at that size: a `u8` that wraps cannot be told from the low byte of a little-endian `u16`/`u32` |
| 1–3 | `00 00 00` | In all 215 payloads |

This conflicts with readings that put a big-endian `u16` sequence number at
bytes 2–3 (the `routeros-mndp` skill, after MAC-Telnet). On 7.26beta5 those
bytes stayed zero while byte 0 counted.

### TLVs

Every payload had the same TLV order: 1, 5, 7, 8, 10, 11, 12, 14, 16, 18,
19, 17, 15. When TLV 17 or 15 was missing, it was left out, not sent
zero-filled. TLV 17 was missing in 51 payloads and TLV 15 in 12. Types 2–4,
6, 9 and 13, and types above 19, did not appear.

| Type | Name | Length | Observed values | Status |
|---|---|---|---|---|
| 1 | MAC address | 6 | Sending interface MAC | Known |
| 5 | Identity | variable | `/system/identity` | Known |
| 7 | Version | 29 | e.g. `7.26beta5 2026-10-30 11:13:55`: version plus build time, no channel | Known |
| 8 | Platform | 8 | `MikroTik` | Known |
| 10 | Uptime | 4 | Seconds, **little-endian** `u32` | Known |
| 11 | Software ID | 11 | Per-router string | Known |
| 12 | Board | 3 | `CHR` | Known |
| 14 | Unpack | 1 | `01` in every payload. The lab does not configure `/ip/packing` | Mapping to `unpack=` still open ([#3](https://github.com/tikoci/m2ir/issues/3)) |
| 15 | IPv6 address | 16 | Link-local address of the sending interface | Known |
| 16 | Interface name | 6 | e.g. `ether2` | Known |
| 17 | IPv4 address | 4 | Address of the sending interface, network order | Known |
| 18 | Running | 1 | `00`, or `02` while `/cmr` (the CMR controller) is enabled | **New**: see below |
| 19 | Unknown | 1 | `79` on every router, CMR or not | **New**: meaning unknown |

**TLV 18 (`running`).** It is `00` normally and `02` while the router runs
an enabled CMR controller. It goes back to `00` when `/cmr` is disabled.
While it is `02`, the receiving router's `/ip/neighbor` row shows
`running=cmr`. Two values were seen, so a bitmask is likely; no other bit
appeared. TLV 18 changed 138 times between one sender's consecutive saved
payloads. In 130 of those changes, no TLV besides uptime changed with it.
The other 8 also changed addresses or came from a new VM with the same lab
name. A CMR *client* left TLV 18 at `00` while enabled, pending,
half-paired and paired. Pairing state is not in MNDP. A client that finds
its controller by discovery connects from its neighbor table. Its SYN left
11–35 ms after `enabled=yes`, with no announcement in between.

**TLV 19.** One byte, `0x79`, from every router. Its meaning is unknown. The
same neighbor rows show `system-caps=bridge,router` and
`system-caps-enabled=router`, but `discovered-by=lldp,mndp`, so LLDP may
supply those values instead. That mapping is a lead, not a finding.

### Timing

- Periodic announcements follow `/ip/neighbor/discovery-settings`
  `discover-interval`, which defaults to `30s` on this build. Within one
  boot no gap exceeded 30.0 s. The `routeros-mndp` skill's "~60 s cycle"
  does not hold here.
- A state change triggers an extra announcement immediately. The
  announcement left 7–49 ms after each controller `/cmr set enabled=…`, for
  all 32 enables and 28 disables. Off-cycle announcements also followed
  identity and address changes at boot.

### Still open

- TLV 19: meaning, and whether its value varies with configuration,
  hardware or version.
- TLV 18: the other bits, and whether any service besides the CMR
  controller sets them.
- TLV 14: the byte for each `unpack=` value, and whether the TLV is ever
  absent ([#3](https://github.com/tikoci/m2ir/issues/3)).
- Header byte 0: its width (one byte, or the low byte of a wider field)
  and when it wraps. It needs more than 255 announcements on one interface
  in one boot.
- Other versions: TLVs 18 and 19 were seen only on 7.26beta5. Their first
  version, and whether any build sends one without the other, are not
  known.
