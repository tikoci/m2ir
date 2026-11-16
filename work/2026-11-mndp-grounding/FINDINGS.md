# MNDP wire map: grounded findings (2026-11-15, requests 2026-11-16)

Findings from the MNDP grounding lab, kept in `work/` until an MNDP
schema exists to promote them into (see [`AGENTS.md`](../../AGENTS.md)).
[`README.md`](README.md) holds the method, harness and evidence index.
[`profiles/mndp/`](../../profiles/mndp/README.md) points here.

## Sources

Four evidence sets back the tables below. None of them is canonical
schema yet, but every row says what was observed and where:

- **m2ir lab**: quickchr CHRs (6.49.23, 7.24.6, 7.25, 7.26beta5) on socket
  links, with one setting changed per step and both routers' sniffers
  streamed to the host. Harness, method and evidence:
  [this directory](README.md).
- **m2ir hub lab** (2026-11-16): CHRs 6.49.23, 7.17.2, 7.18.2, 7.20.8 and
  two 7.26beta5 on one segment that the host joins as a station
  ([`hub.ts`](hub.ts)), so the host can send requests and see every frame
  that comes back with its Ethernet and IP destinations.
- **Field capture**: 35 s of `/tool/sniffer` on a 7.26beta5 RB1100Dx4 whose
  neighbors run RouterOS 6.49.21 and 7.6–7.26beta5 on ARM, ARM64 and MIPSBE
  hardware. Only a [sanitized summary](evidence/field-summary.json)
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
| 1 | `mac-address` (see note) | 6 bytes | — | All sources. The receiver's row uses the frame's Ethernet source, not this TLV (below) |
| 2 | `unpack` | Empty flag: unpacks aggregated packets | — | Lab: present for `unpacking=simple` and above, absent for `none` |
| 3 | `unpack` | Empty flag: decompresses headers | — | Lab: added by `compress-headers` and `compress-all` |
| 4 | `unpack` | Empty flag: decompresses payload | — | Lab: added by `compress-all` |
| 5 | `identity` | UTF-8 bytes as configured (`ü` → `c3 bc`) | — | All sources; lab |
| 6 | (request) | Empty flag: "send your announcement now"; never in an announcement | — | Hub lab: any packet carrying it draws replies, whatever the header, and does not create a neighbor row. See [Requests](#requests) |
| 7 | `version` | Text; format changes by version (below) | — | All sources |
| 8 | `platform` | Text: `MikroTik`, or the branding package's value | — | Field: a branded router sends its branding name |
| 9 | (none seen) | `/ip/packing` `aggregated-size`, `u32`; **little-endian on x86** (CHR), unverified on big-endian CPUs | — | Lab (x86 CHR): 1500 → `dc 05 00 00`, 1000 → `e8 03 00 00`; only with TLV 2. No field sender used packing |
| 10 | `uptime` | Seconds, **little-endian** `u32`, also on MIPSBE | — | All sources; field MIPSBE rows match the neighbor table |
| 11 | `software-id` | Text | — | All sources |
| 12 | `board` | Text | — | All sources |
| 14 | `ipv6` | 1 byte: `01` IPv6 enabled, `00` disabled. Meaning changes by version (below) | — | Lab: `disable-ipv6=yes` → `00`, and `ipv6=true` leaves the neighbor row. Field: every `00` sender showed `ipv6=false`. Hub lab: 6.49 to 7.26beta5 (below) |
| 15 | `address6` | 16 bytes, one TLV per address on the interface (global first, then link-local) | — | Field: two TLV 15s on interfaces with a global address |
| 16 | `interface-name` | Text; `bridge/port` for a bridge port | — | Field: `bridge/ether1` on 6.49 and 7.x |
| 17 | `address4` | 4 bytes, network order | — | All sources |
| 18 | `running` | Bitmask: `01` CAPsMAN, `02` CMR controller, `03` both, `00` none. Receivers print `running=capsman`, `cmr`, `capsman,cmr`, and leave the field out for `00` | 7.20 | Lab: `/interface/wifi/capsman enabled=yes` → `01`. quickchr: `/cmr` → `02`, printed `running=cmr`. Hub lab (7.26beta5 with `cmr`): both on → `03`, printed `capsman,cmr`; each toggle reverses. Field: absent on 7.19.4, present from 7.20. Changelog 7.20: "report router as CAPsMAN on MNDP under running parameter" |
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

**TLV 19 sets the approximate lifetime.** A receiver removes a silent
neighbor at about its TTL or later. The earliest removal fell between age
18 s and 22 s for TTL 21, so removal slightly before the TTL is not ruled
out at this 4 s sampling. Some rows stayed listed up to about 20 s past the
TTL. A periodic expiry check would explain the lag, but the mechanism was
not observed.
Ages are the observer's `/ip/neighbor` `age` (time since the last
announcement):

| Run | TTL | `discovered-by` | Last listed at | Gone by |
|---|---|---|---|---|
| `ageout-mndp`, 30 s | 121 | `mndp` | 123 s | 131 s |
| `ageout-mndp2`, 30 s | 121 | `mndp` | 130 s | 138 s |
| `ageout-mndp`, 5 s | 21 | `lldp,mndp` (stale label) | 18 s | 22 s |
| `ageout-mndp2`, 5 s | 21 | `lldp,mndp` (stale label) | 29 s | 41 s |
| `ageout-mndp2`, 5 s clean | 21 | `mndp` | 36 s | not reached (re-announced) |
| `ageout2`, 5 s | 21 | `lldp,mndp` | 19 s | 24 s |
| `ageout`, 60 s | 241 | `lldp,mndp` | 252 s | — |

In the `ageout-mndp*` runs both routers ran `protocol=mndp`, so nothing
refreshed the rows except MNDP. The first 5 s phase of each still carried
an `lldp` label from before the protocol change. The label outlived LLDP by
minutes, so it is not a live indicator. The "5 s clean" phase starts from a
row MNDP alone created after the 30 s expiry. The `ageout`/`ageout2` rows
were also learned by LLDP before the subject went quiet (`mode=rx-only`
stops both). Treat the TTL as an approximate lifetime, not an exact
expiry time.

Type 13, and anything above 19, appeared in no capture. centrs read 13 as
an alternate board field; nothing here supports that. Type 6 appears only in
requests (below), never in an announcement.

**TLV 14 by version.** The flag meant "IPv6 present" before 7.18 and has
followed `/ipv6/settings disable-ipv6` since. It followed it reliably only
from 7.21 on:

| Sender | `disable-ipv6=yes` | Then reboot | `disable-ipv6=no` |
|---|---|---|---|
| 6.49.23 | not tested; the flag follows the `ipv6` package (below) | — | — |
| 7.17.2 | stays `01` | stays `01` | `01` |
| 7.18.2, 7.20.8 | stays `01` | `00` | `01` at once |
| 7.26beta5 | `00` at once | `00` | `01` at once |

6.49.23 sends `00` while the `ipv6` package is disabled (its default) and
`01` once it is enabled. With the package enabled it also announces over
IPv6, but still sends no TLV 15. On every version, `disable-ipv6=yes` removes
the TLV 15 addresses at once. Changelogs: 7.18 "advertise IPv6 capabilities
based on "Disable IPv6" global setting", 7.21 "fixed MNDP IPv6 status
reporting". So the flag alone does not say whether IPv6 is disabled on a
7.18–7.20 sender, and it never does on 7.17 or older.

**The receiver keys the row on the frame, not on TLV 1.** A spoofed
announcement (Ethernet source `02:4d:4e:44:5c:01`, TLV 1
`02:66:66:66:66:66`, TLV 17 `192.168.77.200`, IP source `.131`) was listed
by 7.26beta5 and 7.17.2 as `mac-address=02:4D:4E:44:5C:01
address4=192.168.77.200`. A packet with no TLV 17 was listed with its IP
source address. A receiver on a UDP socket cannot see the Ethernet source,
so TLV 1 is the best it has. On real routers the two match.

### Requests

A request asks every router on the segment to announce now. The host sent
each candidate from its own station and recorded which of the six routers
(6.49.23, 7.17.2, 7.18.2, 7.20.8 and two 7.26beta5) answered within 4 s.
Every result below held for all six routers, in every round
([`requests-forms.json`](evidence/requests-forms.json): 3 shuffled rounds;
[`requests-main-run2.json`](evidence/requests-main-run2.json);
[`requests-fresh.json`](evidence/requests-fresh.json)).

| Payload (hex) | Form | Replies | Requester listed as a neighbor |
|---|---|---|---|
| `00000000` | Header 0 (MAC-Telnet) | yes | yes, empty identity |
| `0000000000000000` | Header 0 + empty TLV 0 | yes | not checked |
| `0000000000060000` | Header 0 + empty TLV 6 | yes | **no** |
| `000000000006000100` | Header 0 + TLV 6 with a value byte | yes | not checked |
| `0100000000060000`, `0000000100060000` | Non-zero header + empty TLV 6 | yes | not checked |
| Announcement-shaped (TLVs 1, 5), header 0 | | yes | yes, as announced |
| `000000000000000000` | 9 zero bytes (centrs `mndpRefreshPacket`) | **no** (0 of 11 tries) | no |
| `000000000006000000` | Header 0 + TLV 6 + 1 byte (the "9-byte form") | **no** | no |
| `0000000000`, `0000000000000000ffffff`, `00000000000600000000000000`, `010000000006000000` | Any trailing bytes that are not a whole TLV | no | no (checked for `0000000000`) |
| `01000000`, `00000001`, `0100000000000000` | Non-zero header, no TLV 6 | no | yes (`01000000` from a new host) |
| Announcement-shaped, header `05000000` | | no | not checked |
| empty, `000000` | Shorter than a header | no | no |

So a payload is a request when its header is `00000000` **or** it carries
TLV 6. A payload whose TLVs do not end exactly at the end of the datagram is
dropped whole: no reply and no neighbor row. Any well-formed payload, request
or not, creates or refreshes a neighbor row for its sender, except one that
carries TLV 6. A host that sends bare `00000000` requests therefore shows up
in every router's `/ip/neighbor` (empty identity, the host's IPv4); one that
sends `0000000000060000` does not.

The 9-byte forms in circulation do not work. The `routeros-mndp` skill's
"9-byte form" (`00 00 00 00 00 06 00 00 00`) and centrs's nine zero bytes
both carry a trailing byte. In one early run the nine zero bytes seemed to
draw replies from all six routers. Those frames were periodic announcements
that happened to fall in the window: 5 of them came from the five routers
just reconfigured to `discover-interval=1h`, about 70 ms apart in the order
they had been configured, without the 0.2–2 s jitter that replies show (see
the timer finding below), and the sixth was 6.49.23's 60 s periodic. Every
later try failed, including from fresh hosts, after a valid request from
the same host, and in shuffled orders
([`requests-main-run1.json`](evidence/requests-main-run1.json) keeps that
run).

**What a reply looks like.** A reply is an ordinary announcement: the same
payload, sent from port 5678 to `255.255.255.255:5678` and to
`ff02::1:5678` (6.49.23 without the `ipv6` package: IPv4 only). This holds
whether the request came over IPv4 broadcast, subnet broadcast, unicast, from
source `0.0.0.0`, or over IPv6 `ff02::1` (every router with IPv6 answered
it). A unicast request draws a reply
only from the router it is addressed to, and that reply is broadcast too. So
a listener must bind port 5678. The source port of the request does not
matter. Replies come **0.2–2 s** after the request, with a random delay for
each router. Requests that arrive before a router has replied are merged
into one reply (two requests 200 ms apart, or five 50 ms apart, drew one
reply each). Each reply advances the header counter like any other
announcement.

**A boot announcement is a request.** After a reboot the first announcement
has header `00000000` and goes out on IPv4 only (7.26beta5 in
[`dying-gasp-7.26beta5.json`](evidence/dying-gasp-7.26beta5.json); 6.49.23
twice in [`hub-session-2026-11-16.json`](evidence/hub-session-2026-11-16.json)).
Its neighbors answer it: the 7.26beta5 observer announced 561 ms later. The
counter continues from 1.

Prior art: MAC-Telnet sends `00000000`. The author's earlier Swift MNDP tool
sent `0000000000060000` ("mimic winbox"), which works. Its TypeScript port
added a trailing zero, which does not. WinBox's own request was not
captured.

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
- **Changing `discover-interval` does not reschedule the pending periodic
  announcement.** The change sends one triggered announcement. The next
  periodic one still comes on the old schedule, and only after that does the
  new interval apply. Going from 2 h to 10 s, then from 10 s to 1 h, produced
  no periodic announcement for 40 s on any of five routers (7.17.2, 7.18.2,
  7.20.8 and two 7.26beta5). From the 30 s default to 1 h, the five routers'
  next announcements arrived in the order they had been configured, about
  70 ms apart: the pattern a pending schedule produces (see the early run
  under [Requests](#requests)). The first lab saw this once, going from 9 h
  to 5 s. A receiver can therefore go much longer than the new interval (and
  past the TLV 19 TTL it now advertises) without hearing from a router whose
  interval was just shortened. That consequence is inferred; the lab did not
  watch a receiver expire the row.

### Still open

- Type 13 and anything above 19: never seen.
- Other TLV 18 bits: services other than CAPsMAN and CMR were not tried.
- WinBox's request bytes, and whether anything else (RoMON, the Dude) sends
  requests.
- The reply delay's real range: 0.2–2 s fits every reply seen here, but the
  bound was not measured.
- The receiver's expiry timing: why removal lags the TTL by up to about
  20 s, and whether it can come slightly before it.
- TLV 9 byte order on big-endian hardware. Packing TLVs on 6.x and older
  7.x.
- The packed-frame format (EtherType 0x9000) itself
  ([#3](https://github.com/tikoci/m2ir/issues/3)).
