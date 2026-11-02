<!-- cspell:ignore unmappable rowid vrfs i1vrf1 i1vrf1a i1vrf1b quickchr centrs getall jsonl -->
# I1 leg sheet: U-h2-self-offset decider (2nd address in VRF1)

Offline design by worker I1. VM `g4beta5` (7.26beta5, x86, `user` +
`socket::g4b5-link`, spare `ether2`). Execute from the repo root, verbatim,
after an explicit per-leg yes. Do not commit anything.

## 0. Counting rule (read first)

H2/F-vlan rule: every **accepted** control add/set/remove = **1w**.
Reads (control `retrieve` + native GETALL) = 0w. **Rejected adds = 0w
but consume exactly one rowid each** (H3 `P-h3-reject-consumes`), so
every `.id` below is **live-resolved** from the add's `ret` plus a
control read-back — never assumed from append order or reuse. (Reuse
was observed: G4 and H2 both landed VRF `*1` + address `*2`. But
bridges went `*4` then `*5` with no reuse. Anchor on nothing.)
VM start/stop = 0r (H2/G4 precedent).

Budget: **6w+0r core, 9w+0r ceiling** (contingency = 1 counted retry
per remove, S6 only). The brief's +2w is exactly the discriminating
pair W3+W4; the other +4w is setup/setup-teardown forced by H2's exact
restore (see `report.yaml` target note).

Conventions: `I1` = `work/2026-11-winbox-attributes/proof/i1-h2-self-offset`,
`H2` = `work/2026-11-winbox-attributes/proof/H2-f6`,
`G4` = `work/2026-11-winbox-attributes/proof/G4-beta5-populated`.
`N` = VRF `.id`, `M1`/`M2` = address `.ids` — all live-resolved.
Writes need `--yes` (they refuse without it); reads need no flag.

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

Blocks until REST-ready.

## V0/B0. Version gate + baseline (0w)

```sh
centrs retrieve --quickchr g4beta5 /system/resource --format json | bun H2/sanitize.ts > I1/baseline_system_resource.json
centrs retrieve --quickchr g4beta5 /ip/vrf --format json | bun H2/sanitize.ts > I1/baseline_ip_vrf.json
centrs retrieve --quickchr g4beta5 /ip/address --format json | bun H2/sanitize.ts > I1/baseline_ip_address.json
centrs retrieve --quickchr g4beta5 /interface/bridge --format json | bun H2/sanitize.ts > I1/baseline_interface_bridge.json
bun G4/leg-g4.ts --quickchr g4beta5 --allowed-version 7.26beta5 read --out I1/step-B0.jsonl
```

(Expand `H2`/`G4`/`I1` to the paths above; `leg-g4.ts` and
`sanitize.ts` are reused unmodified.)

**S2:** version ≠ 7.26beta5 → STOP. **S1:** B0 must equal the
H2-restored shape — vrf `{*0:main}` count 1, address `{*1
10.0.2.15/24 DHCP}` count 1, bridge count 0, native `[20,1]` = 1 row
(13 keys, f6=0) + `[20,0]` = 3 rows — AND the three control files must
be byte-equal to H2's `restored_*.json`. Any drift → STOP before any
write. **S7:** any tooling error (e.g. version refusal) → STOP.

## W1. Create VRF (+1w, setup)

```sh
centrs explain '/ip/vrf/add name=i1vrf1 interfaces=ether2' --format json > I1/explain-W1-live.json
centrs execute --quickchr g4beta5 --yes '/ip/vrf/add name=i1vrf1 interfaces=ether2' --format json | bun H2/sanitize.ts > I1/control-W1-add.json
centrs retrieve --quickchr g4beta5 /ip/vrf --format json | bun H2/sanitize.ts > I1/control-W1-read.json
```

**S3** on rejection (`ok:false`): 0w — record the rejection, STOP the
write sequence, restore nothing (nothing added), report
REJECTED-STIMULUS. Otherwise `N` = `ret` from `control-W1-add.json`,
confirmed present in `control-W1-read.json`. Cumulative: 1w.

## W2. First VRF1 address (+1w, setup + evidence row r1)

```sh
centrs explain '/ip/address/add address=198.51.100.23/24 interface=ether2 comment=i1vrf1a' --format json > I1/explain-W2-live.json
centrs execute --quickchr g4beta5 --yes '/ip/address/add address=198.51.100.23/24 interface=ether2 comment=i1vrf1a' --format json | bun H2/sanitize.ts > I1/control-W2-add.json
centrs retrieve --quickchr g4beta5 /ip/address --format json | bun H2/sanitize.ts > I1/control-W2-read.json
```

`M1` = live `ret`. **STIMULUS GATE 1:** row `M1` in
`control-W2-read.json` shows `vrf=i1vrf1`, else **S4** (STOP, restore
W1 via W6-with-N, report STIMULUS-FAIL — not an f6 result).

```sh
bun G4/leg-g4.ts --quickchr g4beta5 --allowed-version 7.26beta5 read --out I1/step-W2.jsonl
```

Record f6(r1): the `[20,1]` row with `0xfe0009` = `i1vrf1a`, cross-checked
that `0xfe0001` equals numeric `M1`. **S5** if unmappable → restore
(W5-with-M1, W6-with-N), report AMBIGUOUS. Note whether `N` vs `M1-1`
already discriminates on r1; continue regardless. Cumulative: 2w.

## W3. Second VRF1 address (+1w, DISCRIMINATING add)

```sh
centrs explain '/ip/address/add address=198.51.100.24/24 interface=ether2 comment=i1vrf1b' --format json > I1/explain-W3-live.json
centrs execute --quickchr g4beta5 --yes '/ip/address/add address=198.51.100.24/24 interface=ether2 comment=i1vrf1b' --format json | bun H2/sanitize.ts > I1/control-W3-add.json
centrs retrieve --quickchr g4beta5 /ip/address --format json | bun H2/sanitize.ts > I1/control-W3-read.json
```

`M2` = live `ret`. **STIMULUS GATE 2:** row `M2` shows `vrf=i1vrf1`,
else **S4** (STOP, restore W1+W2, report STIMULUS-FAIL). **S3** on
rejection: record, restore W1+W2 (r1 evidence stands as PARTIAL),
report. Ambiguity pre-check (0w): record `N`, `M1-1`, `M2-1` and any
coincidence.

```sh
bun G4/leg-g4.ts --quickchr g4beta5 --allowed-version 7.26beta5 read --out I1/step-W3.jsonl
```

Record f6(r2) (`0xfe0009` = `i1vrf1b`, `0xfe0001` = numeric `M2`;
**S5** if unmappable). **DECIDE** per §outcome — no further writes
except restore. Cumulative: 3w.

## Outcome

Primary rule = within-VRF contrast (both rows gated in `i1vrf1`):

- f6(r1) == f6(r2) == `N` → self-offset DISPROVEN; VRF-key survives.
- f6(r1) == f6(r2) == X ≠ `N` → both DISPROVEN → NEW UNKNOWN.
- f6(r1) ≠ f6(r2), each == own-rowid-minus-1 → VRF-key DISPROVEN
  (escalate: H2's PROVEN claim needs revision); self-offset survives.
- f6(r1) ≠ f6(r2), not own-minus-1 → both DISPROVEN → NEW UNKNOWN.
- Unmappable row or coinciding predictions → AMBIGUITY-STOP (a
  result, not a failure): the 0w read stands as consistency data.

## W4/W5/W6. Restore removes (+3w)

Re-run `explain` with the LIVE `.id` first in each case (0w,
mandatory — the `*97/98/99` design templates validate syntax only and
must never be sent):

```sh
centrs explain "/ip/address/remove numbers=<M2>" --format json > I1/explain-W4-live.json
centrs execute --quickchr g4beta5 --yes "/ip/address/remove numbers=<M2>" --format json | bun H2/sanitize.ts > I1/control-W4-rm.json
centrs explain "/ip/address/remove numbers=<M1>" --format json > I1/explain-W5-live.json
centrs execute --quickchr g4beta5 --yes "/ip/address/remove numbers=<M1>" --format json | bun H2/sanitize.ts > I1/control-W5-rm.json
centrs explain "/ip/vrf/remove numbers=<N>" --format json > I1/explain-W6-live.json
centrs execute --quickchr g4beta5 --yes "/ip/vrf/remove numbers=<N>" --format json | bun H2/sanitize.ts > I1/control-W6-rm.json
```

Order: newest address first, VRF last (H2 R-order precedent).
**S6:** a failed remove gets ONE counted retry; then continue the
remaining removes best-effort and report RESTORE-FAIL with the exact
residual state. Cumulative: 6w (+retries, ceiling 9w).

## R0. Restore verification (0w)

```sh
centrs retrieve --quickchr g4beta5 /ip/vrf --format json | bun H2/sanitize.ts > I1/restored_ip_vrf.json
centrs retrieve --quickchr g4beta5 /ip/address --format json | bun H2/sanitize.ts > I1/restored_ip_address.json
centrs retrieve --quickchr g4beta5 /interface/bridge --format json | bun H2/sanitize.ts > I1/restored_interface_bridge.json
bun G4/leg-g4.ts --quickchr g4beta5 --allowed-version 7.26beta5 read --out I1/step-restored.jsonl
cmp I1/baseline_ip_vrf.json I1/restored_ip_vrf.json && cmp I1/baseline_ip_address.json I1/restored_ip_address.json && cmp I1/baseline_interface_bridge.json I1/restored_interface_bridge.json
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

TIER 1 (committed bytes): `step-W2/W3.jsonl`, `control-*-read.json`,
baseline/restored pairs (trackable via the `work/**/proof/**/*.json`
exception). TIER 2 (console-observed): `ret` values, gate verdicts,
`cmp` result, `quickchr` console text — quoted in the execution
report. No `fragment.yaml` until post-execution results exist.
