# MNDP grounding lab (2026-11-15)

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
| [`studies.ts`](studies.ts) | Step lists: `probe`, `tlv19`, `ttl`, `ageout`, `ageout2`, `ageout-mndp`, `dying-gasp`, `baseline`, `counter` |
| [`pcap-mndp.ts`](pcap-mndp.ts) | pcapng (RouterOS sniffer file) → distinct MNDP payloads |
| [`field-summary.ts`](field-summary.ts) | Field capture + `/ip/neighbor` → sanitized per-version rows |

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
| [`ageout-mndp-7.26beta5.json`](evidence/ageout-mndp-7.26beta5.json) | Receiver expiry vs TTL with `protocol=mndp` on both sides (no LLDP confound) |
| [`dying-gasp-7.26beta5.json`](evidence/dying-gasp-7.26beta5.json) | Dying-gasp payload (TLVs 1, 19 = `00`, 17, 15) and the counter restart |
| [`field-summary.json`](evidence/field-summary.json) | Hardware: header byte order by CPU, TLV 18/19 version boundaries, repeated TLV 15, TLV 14 vs `ipv6` |

## Run notes

- 7.26beta5 rejects `discover-interval` under 5 s. The `probe` study asked
  for 3 s and so ran at the default 30 s. Its "no announcement" steps
  therefore show settings that do *not* trigger one.
- In `tlv19`, both TZSP streams stopped together after the `romon:on` step.
  Discovery itself kept working (the observer still listed the subject).
  The cause was not found. Later studies streamed normally. Only the steps
  before the stall carry wire data: the file's `coverage` field says so,
  and the later steps show `frames` 0/0.
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
- `ageout`/`ageout2` rows were `discovered-by: lldp,mndp`, so `ageout-mndp`
  repeated the age-out with `protocol=mndp` on both routers.
