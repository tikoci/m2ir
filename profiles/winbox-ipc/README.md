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

## What we know, as of RouterOS 6.49.23 / 7.25

Everything below was tested live against CHR instances of those two
versions plus static binary analysis. It is not a promise about other
versions, hardware, or every handler.

### Addressing is a path, not a port number

A request carries `SYS_TO = [process-id, handler-id, …]`. The `loader`
process (the router's internal message router) strips the destination
process id, prepends the caller id to `SYS_FROM`, and forwards. Each
process's Looper strips the next handler id and dispatches. Replies swap
`SYS_TO`/`SYS_FROM`. Practical consequences:

- Process ids are **version-scoped**. They come from loader config
  (`system.x3`); v6 and v7 maps differ, and v7 ids are only recoverable
  live. Never hard-code a pid from one version into another.
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

This is the part a tool like `centrs retrieve` needs — asking a handler
for its objects without driving the CLI. Proven semantics:

- `GETALL` returns a message array (`0xfe0002`) and, when truncated at
  the ~16 KB cap, a continuation token in `0xfe0003`. Pagination is a
  lower-bound on row id, not an opaque cursor: pass the last row id to
  get the rest.
- **Row order is not creation order and not simple name order.** It is
  a dual-mode mechanism keyed on (class, name) with a rename fixup, and
  it differs subtly between v6 and v7. If you diff two GETALL replies,
  sort by row id yourself; do not read meaning into reply order.
- `ADD`/`SET`/`REMOVE` address rows by row id (`0xfe0001`) through
  slot-7 verbs. `SET` with a mistyped field is **silently ignored** —
  strict typing, no error. Server-derived fields (the `0x10002`/`0x10003`
  flag words on interfaces) cannot be set at all; they are recomputed
  by the router from its own state on every bring-up.
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

## Coverage in numbers (inexact, counted 2026-11-01)

Counted from the YAML in this directory, the 249 live transcripts in
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
| GUI handlers catalogued | 44 |
| Handlers with at least one field mapped | 27 of 44 |
| Handler field entries mapped | 182 (158 named, 24 `unknown-*`) |
| Distinct TLV keys seen in live transcripts | 278 |
| Menu bindings in the v7 registry (HD table) | 296 (98 menus) |
| Distinct CLI command-tree nodes in restraml | 43,189 |
| Distinct CLI argument paths (also the 7.25 argument count) | 37,240 |
| CLI-reference field records across manuals 7.24 / 7.25 / 7.26 | 32,875 total: 10,758 / 10,833 / 11,284 |

How to read this:

- The **envelope is essentially complete**: the 51 SYS/STD keys, 23
  commands, and 13 errors cover the shared machinery every handler
  uses, drained from the Cisco-Talos enum and then corrected live.
- **Per-handler config fields are the long tail.** 182 mapped field
  entries is under 1% of restraml's 37,240 CLI args. That ratio is
  only a proxy — CLI args and nova fields are not 1:1 (args share
  fields, some fields have no CLI arg) — but it gives the right
  order of magnitude: deep on the catalogued handlers, thin overall.
- **Breadth is partial too:** 44 handlers catalogued against 296
  menu bindings in the v7 registry, and 466 handler addresses probed
  in the v7 scans. The catalogued 44 are the ones WinBox exercises
  most, not a random sample.
- Every schema key we reconstructed for the catalogued handlers
  (80 of 80) actually appears in the live transcripts. The gap is
  handlers and fields never probed, not keys invented on paper.
- Quality counts: 284 confidence-tagged entries (150 documented,
  131 observed-only, 3 inferred), 479 evidence references, and 67
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

### Queued next phase — the handler field tail (not blocked)

The CHR-capable portion can start now; individual hardware-dependent fields
may still need separate equipment. The
[attribute and verb discovery plan](../../work/2026-11-winbox-attributes/attribute-discovery-plan.md)
is the agent execution entrypoint. It covers the 17 catalogued handlers
without fields, unknown entries, additional registry bindings, and native
configuration operations useful to UIs and `centrs explain`.

Start by extracting version-scoped candidates from Rosetta and hardening
the existing native prober for lossless evidence, correlated replies,
pagination, and schema checks. Then calibrate on identity and IP addresses,
add an unmapped configuration slice and a grounded private-verb candidate,
and expand through independent handler-family workers. Controlled changes
and inverse native writes establish field meanings and write support;
CLI names/types alone establish neither. Proven results belong in the
canonical YAML, with unknowns and version limits preserved.

This phase is deliberately separate from the §§16–47 series: that
series established the shared protocol machinery, and this one develops
the configuration field and operation catalogue that machinery carries.

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

The current schema incorporates client analysis and live CHR observations
on RouterOS 6.49.23 and 7.25 (§§16–47 of the probe findings). Read each
entry's confidence, version scope, and evidence before reusing a handler
ID or field mapping. Native queries working on 7.25 do not establish
full WinBox 3 client compatibility.

For ongoing work and reproductions, follow the
[client analysis](../../work/2026-10-winbox-client-re/README.md),
[CHR analysis](../../work/2026-10-chr-extraction/README.md), and
[live probe findings](../../work/2026-10-chr-extraction/ws3c-prober-findings.md).
These are research trails; protocol definitions and corrected findings
belong in the YAML above.
