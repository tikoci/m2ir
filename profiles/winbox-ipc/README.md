# profiles/winbox-ipc/

RouterOS IPC over TCP/8291 — the WinBox app's wire conversation with a
router. Same `nv::message` grammar as `dude-on-disk/` and `winbox-cdb/`;
this profile names byte 2 as `namespace` (0xFF=system, 0xFE=session,
0x00=user) and uses the low bit of the tcode to signal compact length.

This page is the human summary. The YAML files next to it are canonical:
when this page and a YAML entry disagree, the YAML entry — with its
`confidence:`, `evidence:`, and `revision-history:` — wins.

## Who this is for

You administer RouterOS and know basic CS concepts (TLV encodings,
request/reply RPC, key derivation). You want to know what WinBox actually
says to the router, what parts of that are proven, and what you could
build or debug with it. You do not need to reverse binaries to use this;
the evidence trail is linked for when you want to check a claim.

## Choose a reading path

- **Packet capture and decoding:** the [agent map](../../llms.txt)'s capture
  path starts at transport, authentication, and session crypto, then reaches
  the wire grammar and handler tables below. The
  [dissector proposal](../../work/2026-10-winbox-dissector/dissector-proposal.md)
  distinguishes the implemented schema shape builder from a proposed
  Wireshark/TShark dissector and secret exporter. Passive capture plus a
  password generally cannot decrypt a session without ephemeral key material.
- **Patched WinBox client compatibility:** start at the
  [WinBox 3 patch review](../../work/2026-11-winbox3-patches/README.md), then
  follow its original-client fingerprint, parser/descriptor findings, and
  schema promotion map. It is a static review; patched binaries were not
  executed by that review. A working native query does not validate a GUI.
- **Native application backends:** use the message files below for routes,
  types, retrieval, pagination, and write/persistence evidence. Then use the
  [experiment harness](../../work/2026-11-winbox-attributes/harness/README.md),
  [fixtures and replay trail](../../fixtures/README.md), and
  [existing consumers](#existing-consumers-and-implementation-status).
  Native handler access, terminal execution, and RouterOS native API need
  separate evidence. Measure efficiency for the intended workload;
  notification lifecycle and wider field coverage remain incomplete.

## The conversation in one picture

```text
WinBox ──TCP/8291──► mproxy ──► loader ──► process (e.g. net, user, sys2)
           chunked      │         │            │
           framing      │         └─ routes by SYS_TO [pid, handler, …]
           EC-SRP5      │            replies swap SYS_TO / SYS_FROM
           handshake    └─ front-end proxy, handler 2 = file transfer
           AES-128-CBC session crypto after login
```

Five layers, each in its own file:

| Layer | File | What it covers |
|---|---|---|
| Wire grammar | [`../../physical/nv-message.yaml`](../../physical/nv-message.yaml) | `M2` TLV types, compact lengths, nested messages |
| Transport | [`transport.yaml`](transport.yaml) | TCP chunk framing (tags 0x01/0x06/0xFF), HKDF magic strings |
| Login | [`ec-srp5-handshake.yaml`](ec-srp5-handshake.yaml) | Four EC-SRP5 handshake messages, pre-encryption |
| Session crypto | [`session-crypto.yaml`](session-crypto.yaml) | Key derivation, AES-128-CBC envelopes, MAC, padding |
| Messages | files below | Handlers, commands, keys, errors, processes |

## What we know, with version scope

The initial shared-machinery investigation used RouterOS 6.49.23 / 7.25
CHR instances and static binary analysis. Later attribute work includes
7.26beta4, selected 7.26beta5 checks, and limited 7.16.2 hardware evidence.
These are not a full version matrix: each entry records which version,
handler, operation, and row shape was actually observed. Some findings
remain static-only or guessed; read the attached evidence and confidence.

### Addressing is a path, not a port number

A request carries `SYS_TO = [process-id, handler-id, …]`. The `loader`
process (the router's internal message router) strips the destination
process id, prepends the caller id to `SYS_FROM`, and forwards. Each
process's Looper strips the next handler id and dispatches. Replies swap
`SYS_TO`/`SYS_FROM`. Practical consequences:

- Process ids are **version-scoped**. The v6 map comes from loader config
  (`system.x3`); the v7.25 registry is compiled into `libumsg`'s PR/HD
  tables. Boot-time aliases and shims need live evidence. Never hard-code
  a pid from one version into another.
- Special routes exist: broadcast `[0xff0001]`, multicast prefix
  `0xff0002`, and pseudo-pids such as `0xff0003` (the looper fabric
  itself, not a process).
- Asking a dead or unroutable pid does not hang forever: the router
  emits **one finite retry pair** (about 0.9 s after the request, over
  inside ~4 s), then silence. Earlier notes claimed an endless 1.42 s
  retry loop; live measurement corrected that.

See [`profile.yaml`](profile.yaml) for the routing model and
[`processes.yaml`](processes.yaml) for the per-version pid census.

### Processes, workers, and the 1024–1030 shim block

RouterOS services are separate processes (`net`, `user`, `sys2`, …),
each registering numbered handlers. The confusing part — several pids
answering as one, worker processes appearing and disappearing — is now
closed:

- **Workers are the shims.** Processes such as the PPP, IPsec, and
  certificate workers run as loopers in a boot-persistent block at
  pids 1024–1030. They never die and re-spawn the way a Unix daemon
  would; the worker branch is selected inside the same binary.
- The block holds seven slots: real shims (PPP server handlers
  {14, 21, 31, 51, 61}, IPsec {3}, certificate {8}, and one empty
  ssld slot) plus **spare slots** that accept on the internal
  `/ram/novasock` socket and otherwise stay inert.
- There is **no static alias table** anywhere in the firmware. Aliases
  and stubs are boot-time router state built by the loader, which is
  why they look inconsistent across boots and versions.

### Reading data natively: GETALL, GETONE, ADD, SET, REMOVE

This is the part a native WinBox backend needs — asking a handler for its
objects without driving the CLI. The catalog records these tested semantics
with per-handler limits:

- `GETALL` returns a message array (`0xfe0002`) and a continuation token
  in `0xfe0003` when truncated by count or the ~16 KB cap. Follow the
  **server-issued token**, which names the next un-emitted row; passing
  the last emitted row can repeat it. Start validation is per-handler:
  `[20,1]` validates an inclusive row id; `[20,0]` uses a lower bound.
  Avoid `count=0`, whose behavior differs between tested v6/v7 handlers.
- **Interface `[20,0]` row order is not creation order or simple name order.**
  It is a tree keyed on (class, name), with unconditional rename re-sorting on
  both tested versions; the earlier dual-mode explanation is superseded.
  If you diff two GETALL replies,
  sort by row id yourself; do not read meaning into reply order.
- `ADD`/`SET`/`REMOVE` address rows by row id (`0xfe0001`) through
  slot-7 verbs. `SET` with a mistyped field is **silently ignored** —
  strict typing, no error in the tested cases. Interface flag word
  `0x10002` is stripped before apply; `0x10003` has both accepted and
  server-owned/recomputed bits. Do not infer write access from read-back
  alone; follow the field's tested setter behavior.
- Field flags are decoded: for example interface flag word `0x10002`
  bits cover MACVLAN parent, ARP support, and being enslavable, with
  matching live refusal/acceptance behavior.

See [`gui-handlers.yaml`](gui-handlers.yaml) for per-handler routes and
field maps, [`std-commands.yaml`](std-commands.yaml) and
[`std-keys.yaml`](std-keys.yaml) / [`sys-keys.yaml`](sys-keys.yaml) for
the shared vocabulary, and [`std-errors.yaml`](std-errors.yaml) for
error codes.

### Persistence: the token is the switch

The most operationally surprising finding. Rows you create over M2 are
stored by the `sstore` process in `/rw/store/cfg.*` files (u32
table/rowid/length records wrapping an `M2` payload):

- A row created **without** an owner token (`0xff001e`) **persists**
  across reboot — and then must be removed explicitly, or it pollutes
  every later experiment (and, on a real router, stays as config you
  did not type into the CLI).
- A row created **with** a token is ephemeral: at the next boot,
  `sstore`'s boot-load scan tombstones it (a 12-byte length-0 record)
  and it never instantiates. No periodic reaper exists; this is
  boot-only, value-free (any token value reaps), and shutdown plays
  no role.
- Tombstoned row ids are reserved: automatic allocation is
  high-water-mark + 1, never reuse; an explicit-rowid ADD can reclaim
  a tombstoned id and fails with `ERROR_EXISTS` on a live one.
- The store file rotates and compacts when junk exceeds 4 KB and free
  space is at least 8× the junk (checked on a minute-scale timer).

Treat untokened M2 writes on a production router as configuration
changes, because that is what the router does.

### Handlers beyond the GUI

The catalog also covers, among others: the `[13, 6]` = WinBox /
`[13, 7]` = WebFig split in the `user` process, `/tool/sms` at handler
125 with its port-state triple, user-list and UserPrefs handlers, and
the terminal surface (handler 76 privates — a separate protocol, only
seeded here). mproxy (the TCP/8291 front end) and undo have their own
seed files.

## Coverage in numbers (inexact, counted 2026-11-02)

Schema totals below were rechecked on 2026-11-06 at m2ir `eee0d00`.
The transcript, registry, Rosetta, and quality figures remain a historical
2026-11-02 snapshot, not current coverage percentages. That snapshot used
the YAML in this directory, the 290 live transcripts in
`work/2026-10-chr-extraction/ws3c/ev/`, and the Rosetta database
(`ros-help` 0.12.0, manuals 7.24–7.26) behind tikoci/restraml. Treat the
ratios as scale indicators, not exact percentages: nobody has a total
count of nova TLVs, because field numbering is local to each handler.

| Measure | Count |
|---|---|
| M2 type codes (`tcodes`) in the wire grammar | 18 |
| Envelope keys named (SYS 20 + STD 31) | 51 |
| STD commands / errors named | 23 / 13 |
| Process entries catalogued | 41 |
| GUI handlers catalogued | 50 |
| Handlers with at least one field mapped | 34 of 50 |
| Handler field entries mapped | 355 (180 named, 175 `unknown-*`) |
| Distinct TLV keys seen in live transcripts | 278 |
| Menu bindings in the v7 registry (HD table) | 296 (98 menus) |
| Distinct CLI command-tree nodes in restraml | 43,189 |
| Distinct CLI argument paths (also the 7.25 argument count) | 37,240 |
| CLI-reference field records across manuals 7.24 / 7.25 / 7.26 | 32,875 total: 10,758 / 10,833 / 11,284 |

How to read this:

- The **envelope is essentially complete**: the 51 SYS/STD keys, 23
  commands, and 13 errors cover the shared machinery every handler
  uses, drained from the Cisco-Talos enum and then corrected live.
- **Per-handler config fields are the long tail.** 355 mapped field
  entries is under 1% of restraml's 37,240 CLI args. That ratio is
  only a proxy — CLI args and nova fields are not 1:1 (args share
  fields, some fields have no CLI arg) — but it gives the right
  order of magnitude: deep on the catalogued handlers, thin overall.
- **Breadth is partial too:** 50 handlers catalogued against 296
  menu bindings in the v7 registry, and 466 handler addresses probed
  in the v7 scans. The catalogued 50 are the ones WinBox exercises
  most, not a random sample.
- Every schema key we reconstructed for the catalogued handlers
  (80 of 80) actually appears in the live transcripts. The gap is
  handlers and fields never probed, not keys invented on paper.
- Quality counts: 288 confidence-tagged entries (150 documented,
  135 observed-only, 3 inferred), 623 evidence references, and 72
  kept revision-history entries recording beliefs live work corrected.

The CLI-reference total includes repeated records across three manual
versions; CLI argument paths also repeat properties under different verbs.
Neither is a count of distinct configuration properties or native TLVs.
The [attribute discovery plan](../../work/2026-11-winbox-attributes/attribute-discovery-plan.md)
records reproducible source queries and replaces these scale proxies with
version-scoped native field and operation coverage for future batches.

## What is not known yet — and why it is parked

These are deliberately separated from the results above. Each needs
something the CHR lab cannot provide, or is a small residue whose
answer would not change a client implementation:

| Open item | Why parked |
|---|---|
| Full RouterBOARD row shape over M2 | Needs real hardware; CHR has no board. Lead: `[24, 35]` on hardware |
| Handler-134 driver | 40 negative probes; needs LTE/CAPsMAN/PPP peers or a WinBox-native capture |
| Trial-license (`nlevel`) proof | Blocked on user trial credentials |
| Terminal surface in depth | Separate protocol; own effort, not a gap in the above |
| Nano-residues (ssld motive, hid-100 enabling message, alias-vector append site, GC timer exact period, zombie-set membership) | Bounded and recorded in the findings; chasing them needs boot-log/churn setups with marginal payoff |

The full still-open list, with evidence counts, is the tail of
[`ws3c-prober-findings.md`](../../work/2026-10-chr-extraction/ws3c-prober-findings.md).

### Attribute and verb research — completed batches and remaining work

The follow-on is already implemented in experimental tooling and has
promoted further mappings into YAML. Start at the
[attribute handoff](../../work/2026-11-winbox-attributes/handoff.yaml) for
completed batches through Phase K, proof directories, and unresolved or
parked experiments. Its recorded head describes that campaign; it is not
the current repository HEAD. The
[execution plan](../../work/2026-11-winbox-attributes/attribute-discovery-plan.md)
preserves the methodology and earlier queues, which the handoff supersedes
for status.

The [harness guide](../../work/2026-11-winbox-attributes/harness/README.md)
documents lossless plaintext capture, request correlation, bounded paging,
schema naming, version checks, and mutation controls. The
[fixture guide](../../fixtures/README.md) connects sanitized evidence to
replay tests. Controlled changes and inverse native writes establish field
meanings and write support; CLI names/types alone establish neither.

This phase is deliberately separate from the §§16–47 series: that
series established the shared protocol machinery, and this one develops
the configuration field and operation catalogue that machinery carries.

## Existing consumers and implementation status

Inspected 2026-11-06: **tikoci/centrs main at
`0221b899da70b8c54410f357fd77c2133b286c08`**. The links below pin that
revision; consult its current matrix before relying on later capabilities.

- [Shared EC-SRP5 source](https://github.com/tikoci/centrs/blob/0221b899da70b8c54410f357fd77c2133b286c08/src/protocols/ec-srp5.ts)
  explicitly cites m2ir's
  [handshake schema](ec-srp5-handshake.yaml). Its minimal-length REDP1/shared
  value handling follows the libucrypto and live-probe corrections. The
  implemented consumers include
  [MAC-Telnet MTWEI](https://github.com/tikoci/centrs/blob/0221b899da70b8c54410f357fd77c2133b286c08/src/protocols/mtwei.ts)
  and [bandwidth-test framing](https://github.com/tikoci/centrs/blob/0221b899da70b8c54410f357fd77c2133b286c08/src/protocols/btest.ts).
- [Regression vectors and provenance](https://github.com/tikoci/centrs/blob/0221b899da70b8c54410f357fd77c2133b286c08/test/fixtures/ec-srp5.json)
  record m2ir's vector provenance and
  [reference implementation](../../work/2026-10-chr-extraction/ws3c/ec-srp5.ts).
  The original m2ir vector file named there is not tracked here; use the
  committed centrs fixture for public replay.
  These deterministic transcripts are calculated, not live captures.
  [Unit tests](https://github.com/tikoci/centrs/blob/0221b899da70b8c54410f357fd77c2133b286c08/test/unit/ec-srp5.test.ts)
  exercise the encoding discriminators and both roles;
  [CHR integration tests](https://github.com/tikoci/centrs/blob/0221b899da70b8c54410f357fd77c2133b286c08/test/integration/ec-srp5.test.ts)
  check RouterOS's bandwidth-test proofs. These are authentication tests,
  not native WinBox retrieval or GUI compatibility tests.
- The [capability matrix](https://github.com/tikoci/centrs/blob/0221b899da70b8c54410f357fd77c2133b286c08/docs/MATRIX.md)
  marks `execute / winbox-terminal` **not-started**. Its native-api
  retrieval/listen support is a separate protocol; shared EC-SRP5 does not
  establish a native WinBox backend or notifications. Those remain future
  centrs applications of the handler research, not implemented support
  demonstrated by this trail.

Within m2ir, the prober and attribute harness are implemented experimental
WinBox consumers. The
[schema shape builder](../../src/tooling/winbox-dissector-shape.ts) and
[tests](../../test/tooling/winbox-dissector-shape.test.ts) implement a data
adapter; the [dissector](../../work/2026-10-winbox-dissector/dissector-proposal.md)
and session-secret exporter remain proposals. No production client or
complete format coverage is implied by these tools.

## Layout

- [`profile.yaml`](profile.yaml) — top-level: namespaces, byte-2-as,
  compact rule, classification on SYS_CMD, refs to the sub-files below.
- [`transport.yaml`](transport.yaml) — TCP/8291 chunked framing
  (tags 0x01/0x06/0xFF) and the HKDF magic strings.
- [`ec-srp5-handshake.yaml`](ec-srp5-handshake.yaml) — four pre-encryption
  handshake messages.
- [`session-crypto.yaml`](session-crypto.yaml) — session key derivation,
  encrypted envelopes, message authentication, and padding.
- [`gui-handlers.yaml`](gui-handlers.yaml) — selected GUI management
  handlers, native retrieval request/reply shapes, and attribute mappings.
- [`sys-keys.yaml`](sys-keys.yaml) — SYS_* keys (namespace 0xFF).
- [`std-keys.yaml`](std-keys.yaml) — STD_* keys (namespace 0xFE).
- [`std-commands.yaml`](std-commands.yaml) — STD_CMD_* values for SYS_CMD.
- [`std-errors.yaml`](std-errors.yaml) — STD_ERROR_* values for SYS_ERRNO.
- [`processes.yaml`](processes.yaml) — handler/process IDs.
- [`commands.yaml`](commands.yaml) — handler-private and legacy
  short-form SYS_CMD values.
- [`mproxy.yaml`](mproxy.yaml) — MarginResearch/Tenable seed for the
  WinBox front-end proxy, including the documented handler-2 file-transfer
  surface.
- [`undo.yaml`](undo.yaml) — current undo seed: Cisco-Talos process-id
  hint, STD_UNDOID cross-link, and explicit remaining gaps.

The original Kaitai-style seed material (chunk frame, M2 TLV grammar,
EC-SRP5 handshake, semantic overlay) is preserved in [`strawman/`](strawman/)
as evidence — the canonical YAML files above are derived from it.

## Research and version scope

The current schema incorporates client analysis, the RouterOS 6.49.23 and
7.25 shared-machinery campaign (§§16–47 of the probe findings), and later
attribute batches with additional version scope noted above. Read each
entry's confidence, version scope, and evidence before reusing a handler
ID or field mapping. Native queries working on 7.25 do not establish
full WinBox 3 client compatibility.

For ongoing work and reproductions, follow the
[client analysis](../../work/2026-10-winbox-client-re/README.md),
[CHR analysis](../../work/2026-10-chr-extraction/README.md), and
[live probe findings](../../work/2026-10-chr-extraction/ws3c-prober-findings.md).
For attribute-batch status, continue to the handoff linked above. These are
research trails; protocol definitions and corrected findings belong in
the YAML above.
