# profiles/mndp/

MikroTik Neighbor Discovery Protocol over UDP. *Not* an `nv::message`
profile — MNDP uses a different TLV grammar (BE u16 tag/length, no
marker/tcode byte). It belongs in m2ir anyway because it carries the
*same semantic values* (RouterOS identity, version, board model, MAC,
IPv4/v6, uptime) that turn up in the nv::message profiles. That's the
empirical case for `/concepts/`.

Byte order is mixed, and the old footgun note ("uptime is the only
little-endian integer") is incomplete. TLV type and length are big-endian
`u16`. Uptime (TLV 10) and aggregated-size (TLV 9) are little-endian `u32`.
The header counter uses the *sender's* native byte order. See the wire map
below.

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

## Grounded wire map (2026-11-15)

Three evidence sets back the tables below. None of them is canonical
schema yet, but every row says what was observed and where:

- **m2ir lab**: quickchr CHRs (6.49.23, 7.24.6, 7.25, 7.26beta5) on socket
  links, with one setting changed per step and both routers' sniffers
  streamed to the host. Harness, method and evidence:
  [`work/2026-11-mndp-grounding/`](../../work/2026-11-mndp-grounding/).
- **Field capture**: 35 s of `/tool/sniffer` on a 7.26beta5 RB1100Dx4 whose
  neighbors run RouterOS 6.49.21 and 7.6–7.26beta5 on ARM, ARM64 and MIPSBE
  hardware. Only a [sanitized summary](../../work/2026-11-mndp-grounding/evidence/field-summary.json)
  is committed.
- **quickchr CMR wire study** (7.26beta5, 215 payloads), at quickchr
  `dd7e0ad99aa51acc79f086fe5d71e65efbb511eb`
  ([tikoci/quickchr#277](https://github.com/tikoci/quickchr/pull/277)):
  [FINDINGS.md → Wire → MNDP](https://github.com/tikoci/quickchr/blob/dd7e0ad99aa51acc79f086fe5d71e65efbb511eb/examples/cmr/FINDINGS.md#mndp)
  and its [evidence files](https://github.com/tikoci/quickchr/tree/dd7e0ad99aa51acc79f086fe5d71e65efbb511eb/examples/cmr/evidence/7.26beta5).

Changelog entries cited by version come from MikroTik's changelogs, read
through rosetta.

### Header

Bytes 0–3 are one `u32` announcement counter in the sender's CPU byte
order. It counts every announcement on that interface, periodic or
triggered, and restarts at boot. The IPv4 and IPv6 copies of one
announcement carry the same value.

- Little-endian on x86, ARM and ARM64. A 7.26beta5 RB1100Dx4 sent
  `20 7c 01 00` (97,312) at 973,177 s uptime and a 10 s interval, so the
  carry into byte 2 is real.
- Big-endian on MIPSBE: a 7.25beta5 RB912R sent `00 00 23 58` (9,048) at
  271,468 s uptime, one count per 30 s. A 7.23beta4 RB924iR (also MIPSBE)
  reads the same way.
- In the field capture, uptime ÷ counter ≈ the discover-interval for every
  device. That held on 6.49 and on 7.6–7.12 (≈60 s), and on 7.19 and later
  (≈30 s).

This replaces two earlier readings: version + TTL bytes plus a
big-endian sequence number at bytes 2–3 (MAC-Telnet, the `routeros-mndp`
skill), and "byte 0 only" (the first quickchr reading). A short-uptime
little-endian router shows only byte 0 moving; a long-uptime big-endian
router puts the moving bytes at 2–3.

### TLVs

Type and length are big-endian `u16`; the value follows. Neighbor field
names are as `/ip/neighbor` prints them on 7.26beta5.

| Type | `/ip/neighbor` field | Value | Since | Grounding |
|---|---|---|---|---|
| 1 | `mac-address` | 6 bytes | — | All sources |
| 2 | `unpack` | Empty flag: unpacks aggregated packets | — | Lab: present for `unpacking=simple` and above, absent for `none` |
| 3 | `unpack` | Empty flag: decompresses headers | — | Lab: added by `compress-headers` and `compress-all` |
| 4 | `unpack` | Empty flag: decompresses payload | — | Lab: added by `compress-all` |
| 5 | `identity` | UTF-8 bytes as configured (`ü` → `c3 bc`) | — | All sources; lab |
| 7 | `version` | Text; format changes by version (below) | — | All sources |
| 8 | `platform` | Text: `MikroTik`, or the branding package's value | — | Field: a branded router sends its branding name |
| 9 | (none seen) | `/ip/packing` `aggregated-size`, **little-endian** `u32` | — | Lab: 1500 → `dc 05 00 00`, 1000 → `e8 03 00 00`; only with TLV 2 |
| 10 | `uptime` | Seconds, **little-endian** `u32`, also on MIPSBE | — | All sources; field MIPSBE rows match the neighbor table |
| 11 | `software-id` | Text | — | All sources |
| 12 | `board` | Text | — | All sources |
| 14 | `ipv6` | 1 byte: `01` IPv6 enabled, `00` disabled | — | Lab: `disable-ipv6=yes` → `00`, and `ipv6=true` leaves the neighbor row. Field: every `00` sender showed `ipv6=false` |
| 15 | `address6` | 16 bytes, one TLV per address on the interface (global first, then link-local) | — | Field: two TLV 15s on interfaces with a global address |
| 16 | `interface-name` | Text; `bridge/port` for a bridge port | — | Field: `bridge/ether1` on 6.49 and 7.x |
| 17 | `address4` | 4 bytes, network order | — | All sources |
| 18 | `running` | Bitmask: `01` CAPsMAN, `02` CMR controller | 7.20 | Lab: `/interface/wifi/capsman enabled=yes` → `01`. quickchr: `/cmr` → `02`. Field: absent on 7.19.4, present from 7.20. Changelog 7.20: "report router as CAPsMAN on MNDP under running parameter" |
| 19 | (entry lifetime) | TTL seconds, `u8`: `min(discover-interval × 4 + 1, 255)`; `00` = dying gasp | 7.24 | Lab: 5 s → `15`, 7 s → `1d`, 30 s → `79`, 60 s → `f1`, 64 s/300 s/9 h → `ff`. Field: 10 s → `29`. Absent on 7.24beta1 and older; changelog 7.24 adds dying-gasp "TTL=0" |

**TLV 14 is not `unpack`.** MAC-Telnet, the Wireshark dissector, centrs
and the `routeros-mndp` skill all name it "unpack". In the lab,
`/ip/packing` never changed TLV 14, while `/ipv6/settings disable-ipv6`
flipped it and the observer's `ipv6` field with it. The `unpack` field is
built from TLVs 2–4 instead:

| Sender `/ip/packing` `unpacking=` | TLVs sent | Receiver shows `unpack=` |
|---|---|---|
| no entry, disabled entry, or `none` | none | `none` |
| `simple` | 2, 9 | `simple` |
| `compress-headers` | 2, 3, 9 | `uncompress-headers` |
| `compress-all` | 2, 3, 4, 9 | `uncompress-all` |

Only the `unpacking` side is announced: `packing=compress-all
unpacking=none` sends nothing. An entry on another interface does not
change ether2's announcement. TLVs 2–4 and 9 follow TLV 1 directly. They
are the "packing TLVs 2, 3 and 9" an earlier skill revision listed without
a source. That claim was right.

**TLV 19 drives expiry.** At a 5 s interval (TTL 21) the receiver dropped a
silent neighbor between age 19 s and 24 s. At 30 s (TTL 121) it was still
listed at 135 s and gone by 140 s. Expiry follows the TTL, checked on a
coarser timer.

Types 6 and 13, and anything above 19, appeared in no capture. centrs reads
13 as an alternate board field; nothing here supports that.

### Layout by version

| Versions (observed) | TLV order |
|---|---|
| 6.49, 7.6–7.19 | 1, 5, 7, 8, 10, 11, 12, 14, [15], 16, 17 |
| 7.20–7.23 | 1, 5, 7, 8, 10, 11, 12, 14, [15], 16, 17, 18 |
| 7.24beta1 | 1, 5, 7, 8, 10, 11, 12, 14, 16, 18, 17 (centrs fixture) |
| 7.24.5 and later | 1, [2, 3, 4, 9], 5, 7, 8, 10, 11, 12, 14, 16, 18, 19, 17, 15… |

TLVs 15 and 17 are left out when the interface has no such address,
including the first announcements after boot. The 6.49.23 CHR sends no TLV
15 (IPv6 is off by default on 6.x).

TLV 7 text formats:

| Versions | Example |
|---|---|
| 6.x | `6.49.21 (long-term)` |
| 7.6–7.13 | `7.12.1 (stable) Nov/17/2023 11:38:45` |
| 7.14–7.24 | `7.24.6 (long-term) 2026-10-30 08:24:29` |
| 7.25 and later (7.25beta5 seen) | `7.25.1 2026-11-02 12:39:53` (no channel) |

The 7.13/7.14 boundary comes from a neighbor table (7.13.5 and 7.14.3
neighbors), not a capture. The channel loss is pinned by the lab sweep:
7.24.6 sends it, 7.25 does not.

### Timing and lifecycle

- **Interval.** Periodic announcements follow `discover-interval`. The
  default changed from 60 s to 30 s in 7.16 (changelog), matching the field
  counters. 7.26beta5 rejects values under 5 s.
- **Triggered announcements.** These changes sent an announcement at once
  and advanced the counter: identity, CAPsMAN, CMR, `/ip/packing`, IPv6
  on/off, discovery `protocol`, `lldp-med`, `mode` and `discover-interval`.
  So do address changes (changelog 7.21). These kept the 30 s cadence
  instead: MAC server, MAC WinBox and MAC ping, RoMON, bandwidth server,
  the IP services (winbox, api, ssh, telnet, ftp, api-ssl, www-ssl), cloud
  DDNS, remote DNS and IP forwarding.
- **Transport.** Each announcement goes out twice, as an IPv4 broadcast
  and an IPv6 `ff02::1` multicast, with the same payload. `mode=rx-only`
  stops both.
- **Dying gasp** (`dying-gasp=yes`, 7.24+). On reboot the router sends a
  short announcement: header (the counter continues), then TLVs 1, 19 =
  `00`, 17, 15. The changelog says receivers clear the entry on it; the
  lab did not time that.
- **One timer observation.** After `discover-interval=9h` and then `5s`,
  the next periodic announcement did not come for over a minute, so the
  pending timer may not be rescheduled. Seen once.

### Still open

- Types 6 and 13 and anything above 19: never seen.
- TLV 18 with both CAPsMAN and CMR running (`03`?), and other services.
- TLV 9 byte order on big-endian hardware. Packing TLVs on 6.x and older
  7.x.
- 6.x with the IPv6 package enabled.
- The packed-frame format (EtherType 0x9000) itself
  ([#3](https://github.com/tikoci/m2ir/issues/3)).
