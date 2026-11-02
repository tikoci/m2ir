<!-- cspell:ignore unmappable rowid vrfs i1mainb quickchr centrs getall jsonl -->
# I1 leg sheet, Option B: U-h2-self-offset decider (2nd address in MAIN)

Coordinator re-sheet (Option A sheeted VRF1 at 6w; user approved Option B
at 2w). VM `g4beta5` (7.26beta5, x86, `user` + `socket::g4b5-link`,
`ether1` = main interface carrying the DHCP row). Execute from the repo
root, verbatim. Do not commit anything.

Discrimination logic (both hypotheses universal over rows, so a main-VRF
contrast decides exactly as a VRF1 contrast would): VRF-key predicts
f6 == 0 (main `.id` `*0`) for ANY main row; self-offset predicts
f6 == own-rowid-minus-1. The new row's `.id` M cannot be *1 (live DHCP),
so M-1 != 0 always — coincidence is impossible by construction, and the
within-read contrast (DHCP row vs new row, same GETALL) needs no
absolute `.id` assumptions.

## 0. Counting rule (read first)

H2/F-vlan rule: every **accepted** control add/set/remove = **1w**.
Reads (control `retrieve` + native GETALL) = 0w. **Rejected adds = 0w
but consume exactly one rowid each** (H3 `P-h3-reject-consumes`), so
every `.id` below is **live-resolved** from the add's `ret` plus a
control read-back — never assumed. VM start/stop = 0r (H2/G4 precedent).

Budget: **2w+0r core, 3w+0r ceiling** (contingency = 1 counted remove
retry, S6 only).

Conventions: `I1` = `work/2026-11-winbox-attributes/proof/i1-h2-self-offset`,
`H2` = `work/2026-11-winbox-attributes/proof/H2-f6`,
`G4` = `work/2026-11-winbox-attributes/proof/G4-beta5-populated`.
`M` = new address `.id`, live-resolved. Writes need `--yes` (they refuse
without it); reads need no flag.

## P0. Pre-flight (0w+0r)

```sh
quickchr list
```

Confirm `g4beta5` exists and is STOPPED; note the ports block for the
report (redact numerics per H2 rule). **S0:** missing or already
running → STOP. Never let `start` create a factory machine on a typo.

## P1. Start (0w+0r)

```sh
quickchr start g4beta5
```

Blocks until REST-ready. If it does not return, poll readiness with a
cheap retrieve (no `--wait` flag exists); do not proceed blind.

## V0/B0. Version gate + baseline (0w)

```sh
centrs retrieve --quickchr g4beta5 /system/resource --format json | bun H2/sanitize.ts > I1/baseline_b_system_resource.json
centrs retrieve --quickchr g4beta5 /ip/vrf --format json | bun H2/sanitize.ts > I1/baseline_b_ip_vrf.json
centrs retrieve --quickchr g4beta5 /ip/address --format json | bun H2/sanitize.ts > I1/baseline_b_ip_address.json
centrs retrieve --quickchr g4beta5 /interface/bridge --format json | bun H2/sanitize.ts > I1/baseline_b_ip_bridge.json
bun G4/leg-g4.ts --quickchr g4beta5 --allowed-version 7.26beta5 read --out I1/step-B0b.jsonl
```

(Expand `H2`/`G4`/`I1` to the paths above; `leg-g4.ts` and
`sanitize.ts` are reused unmodified.)

**S2:** version != 7.26beta5 → STOP. **S1:** B0 must equal the
H2-restored shape — vrf `{*0:main}` count 1, address `{*1
10.0.2.15/24 DHCP}` count 1, bridge count 0, native `[20,1]` = 1 row
(13 keys, f6=0) + `[20,0]` = 3 rows — AND the three control files must
be byte-equal to H2's `restored_*.json`. Any drift → STOP before any
write. **S7:** any tooling error (e.g. version refusal) → STOP.

## W1. Second main address (+1w, DISCRIMINATING add)

```sh
centrs explain '/ip/address/add address=198.51.100.25/24 interface=ether1 comment=i1mainb' --format json > I1/explain-W1b-live.json
centrs execute --quickchr g4beta5 --yes '/ip/address/add address=198.51.100.25/24 interface=ether1 comment=i1mainb' --format json 2>I1/raw-W1b.err | bun H2/sanitize.ts > I1/control-W1b-add.json; rm -f I1/raw-W1b.err
centrs retrieve --quickchr g4beta5 /ip/address --format json | bun H2/sanitize.ts > I1/control-W1b-read.json
```

**S3** on rejection (`ok:false`, envelope on STDERR): 0w — record the
rejection, STOP the write sequence, restore nothing (nothing added),
report REJECTED-STIMULUS. Otherwise `M` = `ret` from
`control-W1b-add.json`, confirmed present in `control-W1b-read.json`.

**STIMULUS GATE:** row `M` in `control-W1b-read.json` shows
`interface=ether1` AND `vrf=main` (H2-restored precedent: the DHCP row
carries explicit `vrf=main`), else **S4** (STOP, remove M, report
STIMULUS-FAIL — not an f6 result). Ambiguity pre-check (0w): record
`M` and `M-1`; coincidence with 0 requires M=1, impossible (`*1`
live) — record the values anyway.

```sh
bun G4/leg-g4.ts --quickchr g4beta5 --allowed-version 7.26beta5 read --out I1/step-W1b.jsonl
```

Record f6(r2): the `[20,1]` row with `0xfe0009` = `i1mainb`,
cross-checked that `0xfe0001` equals numeric `M`; and f6(dhcp): the
`10.0.2.15/24` row. **S5** if either unmappable → remove M, report
AMBIGUOUS. **DECIDE** per §outcome — no further writes except restore.
Cumulative: 1w.

## Outcome

Primary rule = within-read contrast in main (both rows gated in main,
same GETALL):

- f6(r2) == f6(dhcp) == 0 → self-offset DISPROVEN; VRF-key survives
  (P-h2-f6-rowid stands, finer point closed).
- f6(r2) == f6(dhcp) == X != 0 → both DISPROVEN → NEW UNKNOWN.
- f6(r2) != f6(dhcp), f6(r2) == M-1 → VRF-key DISPROVEN (escalate:
  H2's PROVEN claim needs revision); self-offset survives.
- f6(r2) != f6(dhcp), not M-1 → both DISPROVEN → NEW UNKNOWN.
- Unmappable row → AMBIGUITY-STOP (a result, not a failure): the 0w
  read stands as consistency data.

## W2. Restore remove (+1w)

Re-run `explain` with the LIVE `.id` first (0w, mandatory — the `*97`
design template validates syntax only and must never be sent):

```sh
centrs explain "/ip/address/remove numbers=<M>" --format json > I1/explain-W2b-live.json
centrs execute --quickchr g4beta5 --yes "/ip/address/remove numbers=<M>" --format json 2>I1/raw-W2b.err | bun H2/sanitize.ts > I1/control-W2b-rm.json; rm -f I1/raw-W2b.err
```

**S6:** a failed remove gets ONE counted retry; then report
RESTORE-FAIL with the exact residual state. Cumulative: 2w (+retry,
ceiling 3w).

## R0. Restore verification (0w)

```sh
centrs retrieve --quickchr g4beta5 /ip/vrf --format json | bun H2/sanitize.ts > I1/restored_b_ip_vrf.json
centrs retrieve --quickchr g4beta5 /ip/address --format json | bun H2/sanitize.ts > I1/restored_b_ip_address.json
centrs retrieve --quickchr g4beta5 /interface/bridge --format json | bun H2/sanitize.ts > I1/restored_b_ip_bridge.json
bun G4/leg-g4.ts --quickchr g4beta5 --allowed-version 7.26beta5 read --out I1/step-restored-b.jsonl
cmp I1/baseline_b_ip_vrf.json I1/restored_b_ip_vrf.json && cmp I1/baseline_b_ip_address.json I1/restored_b_ip_address.json && cmp I1/baseline_b_ip_bridge.json I1/restored_b_ip_bridge.json
```

Verdict EQUAL (all three byte-equal, data+count) or FAIL (report with
evidence; no further writes). Native: `[20,1]` = 1 row, `[20,0]` = 3
rows.

## End

```sh
quickchr stop g4beta5
```

End state STOPPED, not removed. 0w+0r.

## Evidence tiers

TIER 1 (committed bytes): `step-W1b.jsonl`, `control-W1b-read.json`,
baseline/restored pairs (trackable via the `work/**/proof/**/*.json`
exception). TIER 2 (console-observed): `ret` values, gate verdicts,
`cmp` result, `quickchr` console text — quoted in the execution
report. No `fragment.yaml` until post-execution results exist.
