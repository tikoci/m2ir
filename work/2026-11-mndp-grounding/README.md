# MNDP grounding lab (2026-11-15, hub lab 2026-11-16)

Live grounding for the MNDP wire map. [`FINDINGS.md`](FINDINGS.md) holds
the conclusions, and [`profiles/mndp/`](../../profiles/mndp/README.md)
points to it. This file holds the method, the harness and the evidence.

## Method

Two quickchr 0.5.2 CHRs on a `socket::` link, both with `user` as ether1
(REST, host gateway `10.0.2.2`). The *subject* is changed one setting at a
time. The *observer* shows how a receiver renders it in `/ip/neighbor`.
Both routers run `/tool/sniffer` on the link (`filter-ip-protocol=udp
filter-port=5678`). Each streams TZSP to its own host port, so every frame
records which side saw it (`via`). The observer's copy also survives the
subject's reboot (dying gasp).

Each study step sends RouterOS commands over REST `/rest/execute`, waits,
and reads the observer's neighbor row for the subject. Steps that toggle a
setting come in pairs (change, then revert). That way a TLV change can be
pinned to one setting and shown to reverse.

The version sweep linked one observer (7.26beta5) to 6.49.23, 7.24.6, 7.25
and 7.26beta5 CHRs, one link each, all at factory defaults.

The **hub lab** (2026-11-16) puts the host on the segment. RouterOS cannot
send an arbitrary UDP payload, so request studies need a station the host
controls. Each CHR gets its own `listen-connect` socket and is its only
member, so QEMU listens on that port. [`hub.ts`](hub.ts) connects to every
port, floods each frame to the other links (the CHRs see each other as on
one segment), and is a station there itself: it sends requests,
answers ARP and IPv6 neighbor solicitations for its own addresses, and logs
every UDP/5678 frame it receives with Ethernet and IP destinations. The
studies talk to it over `127.0.0.1:15699`. The CHRs were 6.49.23, 7.17.2,
7.18.2, 7.20.8 and two 7.26beta5 (observer and subject), with `192.168.77.N/24`
on ether2. The 7.x routers ran `discover-interval=1h`, so periodic
announcements stayed out of the reply windows.

The field capture used `/tool/sniffer file-name=` on a production 7.26beta5
RB1100Dx4 for about 35 s, filtered to UDP 5678. Its neighbors include
RouterOS 6.49.21 and 7.6–7.26beta5 on ARM, ARM64 and MIPSBE hardware, over
Ethernet, VLAN, EoIP and ZeroTier. The raw pcapng holds identities, license
software-ids and public addresses, so it is **not committed**. Only the
sanitized [`field-summary.json`](evidence/field-summary.json) is. The
router's sniffer settings were saved before the capture, restored
afterwards (checked by diff), and the capture file was deleted from the
router.

## Files

| File | Purpose |
|---|---|
| [`mndp-wire.ts`](mndp-wire.ts) | Dependency-free decoders: TZSP v1 → Ethernet → UDP/5678 → MNDP header + raw TLVs |
| [`lab.ts`](lab.ts) | Study runner: arms both sniffers, runs steps, records announcements and neighbor rows |
| [`studies.ts`](studies.ts) | Step lists: `probe`, `tlv19`, `ttl`, `ageout`, `ageout2`, `ageout-mndp`, `dying-gasp`, `baseline`, `counter` (`ageout-mndp` gained a clean 5 s phase after the first run) |
| [`pcap-mndp.ts`](pcap-mndp.ts) | pcapng (RouterOS sniffer file) → distinct MNDP payloads |
| [`field-summary.ts`](field-summary.ts) | Field capture + `/ip/neighbor` → sanitized per-version rows |
| [`station.ts`](station.ts) | Host L2 hub + station over QEMU `listen-connect` sockets; frame builders for UDP over IPv4/IPv6 |
| [`hub.ts`](hub.ts) | Long-running hub with a control API: `POST /send` injects a request, `GET /frames` returns what came back |
| [`requests.ts`](requests.ts) | Request study: sets `main` (transports, ports, bursts), `forms` (payload variants, `--rounds` shuffled) and `fresh` (never-seen hosts, then reads every router's neighbor table) |
| [`hubstudy.ts`](hubstudy.ts) | Setting studies on the hub: `ipv6` (TLV 14 vs `disable-ipv6`, across reboots) and `running` (TLV 18 with CAPsMAN and CMR) |

## Reproduce

```sh
quickchr add --name mndp-obs --version 7.26beta5 --arch x86 --add-network user --add-network socket::mndp-ab
quickchr add --name mndp-sub --version 7.26beta5 --arch x86 --add-network user --add-network socket::mndp-ab
quickchr start mndp-obs --no-wait; quickchr start mndp-sub --no-wait
centrs retrieve --quickchr mndp-sub /system/resource --wait 3m
bun work/2026-11-mndp-grounding/lab.ts mndp-sub mndp-obs probe out.json
```

Add a fifth argument to sniff more observer interfaces (for example
`ether2,ether3,ether4,ether5` for the sweep).

The hub lab:

```sh
quickchr networks sockets create mndp-h-obs --mode listen-connect --port 15681
quickchr add --name mndp2-obs --version 7.26beta5 --arch x86 --add-network user --add-network socket::mndp-h-obs
# … one socket and machine per router (sub 7.26beta5, 7.17.2, 7.18.2, 7.20.8, 6.49.23), then start them,
# add 192.168.77.N/24 on ether2 and set discover-interval=1h on the 7.x routers
bun work/2026-11-mndp-grounding/hub.ts mndp2-obs=15681 mndp2-sub=15682 …   # keep running
bun work/2026-11-mndp-grounding/requests.ts out.json --set=forms --rounds=3 obs=mndp2-obs sub=mndp2-sub … r649=mndp2-v6@192.168.77.6
bun work/2026-11-mndp-grounding/hubstudy.ts ipv6 out.json observer=mndp2-obs r717=mndp2-717 …
```

The first name given to `requests.ts` is the observer (its neighbor table
resolves 6.x MACs) and the second is the unicast target. `hubstudy.ts
running` needs the `cmr` package on the subject.

## Evidence

All `evidence/*.json` files from `lab.ts` hold `subject`/`observer`
versions, every step's commands and results, the observer's neighbor rows,
per-step `frames` (MNDP frames each sniffer delivered on the link, from
either router; `null` when that sniffer had delivered nothing for 45 s, so
its stream had stalled and the step has no wire coverage), and every
captured announcement (`payloadHex` plus a
readable `summary`). `payloadHex` is the evidence; `summary` is derived
from it with the current `NAMES` table. Summaries and `frames` in the files
captured before 2026-11-16 were regenerated from `payloadHex` after TLV 14
was renamed `ipv6-enabled`. CHR MACs and software-ids are disposable lab
values.

| File | Shows |
|---|---|
| [`sweep-baseline.json`](evidence/sweep-baseline.json) | 6.49.23 / 7.24.6 / 7.25 / 7.26beta5 defaults: TLV order, TLV 19 in 7.24.6, channel dropped in 7.25 |
| [`probe-7.26beta5.json`](evidence/probe-7.26beta5.json) | TLVs 2/3/4/9 from `/ip/packing`; TLV 14 follows `disable-ipv6`; TLV 18 = `01` for CAPsMAN; UTF-8 identity; which changes trigger an announcement |
| [`tlv19-7.26beta5.json`](evidence/tlv19-7.26beta5.json) | TLV 19 moved `79` → `15` with the interval, not with any service toggle (see run notes) |
| [`ttl-7.26beta5.json`](evidence/ttl-7.26beta5.json) | TLV 19 = `min(interval × 4 + 1, 255)` for 5 s to 9 h |
| [`ageout-7.26beta5.json`](evidence/ageout-7.26beta5.json), [`ageout2-7.26beta5.json`](evidence/ageout2-7.26beta5.json) | Receiver expiry vs TTL; TLV 9 = `aggregated-size`; packing-only sends nothing |
| [`ageout-mndp-7.26beta5.json`](evidence/ageout-mndp-7.26beta5.json), [`ageout-mndp2-7.26beta5.json`](evidence/ageout-mndp2-7.26beta5.json) | Receiver expiry vs TTL with `protocol=mndp` on both sides; run 2 adds a 5 s phase on a row only MNDP created. Removal comes at about the TTL or up to ~20 s after it |
| [`dying-gasp-7.26beta5.json`](evidence/dying-gasp-7.26beta5.json) | Dying-gasp payload (TLVs 1, 19 = `00`, 17, 15) and the counter restart |
| [`requests-forms.json`](evidence/requests-forms.json) | Which payloads count as a request: 15 forms × 3 shuffled rounds, six routers |
| [`requests-main-run1.json`](evidence/requests-main-run1.json), [`requests-main-run2.json`](evidence/requests-main-run2.json) | Transports (broadcast, subnet broadcast, unicast, `0.0.0.0`, `ff02::1`), source ports, bursts; reply destination and delay. Run 1's announcements after the 9-zero-byte send are unexplained; likely already-scheduled announcements (FINDINGS → Requests) |
| [`requests-fresh.json`](evidence/requests-fresh.json) | Requests from never-seen hosts, and whether each router then lists the host |
| [`running-7.26beta5.json`](evidence/running-7.26beta5.json) | TLV 18 = `01`/`02`/`03`/`00` with CAPsMAN and CMR, and how the observer prints each |
| [`ipv6-7.17-7.26beta5.json`](evidence/ipv6-7.17-7.26beta5.json) | TLV 14 vs `disable-ipv6` on 7.17.2, 7.18.2, 7.20.8 and 7.26beta5, live and after reboot |
| [`hub-session-2026-11-16.json`](evidence/hub-session-2026-11-16.json) | Every UDP/5678 frame the hub station received from `requests-fresh` on, with anchors for the ad hoc checks (9-zero-byte sequences, `discover-interval` timer, 6.49.23 with the `ipv6` package, the spoofed announcement) |
| [`field-summary.json`](evidence/field-summary.json) | Hardware: header byte order by CPU, TLV 18/19 version boundaries, repeated TLV 15, TLV 14 vs `ipv6` |

## Run notes

- 7.26beta5 rejects `discover-interval` under 5 s. The `probe` study asked
  for 3 s and so ran at the default 30 s. Its "no announcement" steps
  therefore show settings that do *not* trigger one.
- In `tlv19`, both TZSP streams stopped together after the `romon:on` step.
  Discovery itself kept working (the observer still listed the subject).
  The cause was not found. Later studies streamed normally. Only the steps
  before the stall carry wire data: the file's `coverage` field says so.
  The later steps show `frames` 0/0 for `romon:off`, `btest:on` and
  `btest:off` (inside the 45 s stall window) and `null` from `svc-winbox:on` on; all
  of them lack wire coverage.
- `ageout` started with the subject silent. The previous study had set
  `discover-interval=9h` and then `5s`, and the next periodic announcement
  did not come for over a minute. `ageout2` repeated the age-out cleanly.
- `counter` (1 s interval) is defined but was not run: 7.26beta5's 5 s
  minimum makes it slow, and the field capture already shows the counter
  across byte boundaries.
- In `ageout2`, both streams stalled again after t=212 s, partway through
  the 30 s age-out. Neighbor rows are REST reads and stay valid; the file's
  `coverage` field says so, and the later steps' `frames` are `null`.
  `lab.ts` now applies the same 45 s stall rule while it runs.
- Hub lab: a quickchr `mcast` socket was tried first. quickchr passes no
  `localaddr=`, so the group rides the host's LAN interface, and this host's
  firewall drops looped-back multicast there: every member was silent with no
  error. Plain host multicast on `127.0.0.1` worked. Per-router
  `listen-connect` sockets joined by `hub.ts` replaced it. This is quickchr's
  mcast "Defect 1" ([tikoci/quickchr#167](https://github.com/tikoci/quickchr/issues/167);
  Linux evidence in
  [this comment](https://github.com/tikoci/quickchr/issues/167#issuecomment-6920467098)).
- Hub lab: the `cmr` package was fetched onto the subject over the `user`
  network (`/tool/fetch` from a host HTTP server on `10.0.2.2`) and installed
  by reboot; a REST upload is capped at 60 KB.
- Hub lab: the 6.49.23 CHR kept the `ipv6` package change across reboots but
  lost its identity and IPv4 address each time, so its announcements after a
  reboot carry `MikroTik` and no TLV 17. The first `/system/package/enable
  ipv6` over the native API trapped; `numbers=ipv6` worked.
- Hub lab: `hub.ts` logs the frames it receives, not the ones it sends. The
  study files record each send; the ad hoc sends are written out in
  `hub-session-2026-11-16.json` → `anchors`.
- `ageout`/`ageout2` rows were `discovered-by: lldp,mndp`, so `ageout-mndp`
  repeated the age-out with `protocol=mndp` on both routers. Its 5 s phase
  still carried a stale `lldp` label, so the study gained a clean 5 s phase
  and ran again as `ageout-mndp2`. The two runs removed the same TTL-21 row
  at different ages (≤22 s vs 29–41 s): removal comes at about the TTL
  or later, possibly on a periodic check (not observed).
