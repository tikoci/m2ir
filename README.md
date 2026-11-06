# m2ir

**An evidence-backed reference for MikroTik's binary protocols and data formats.**

`m2ir` collects hard-earned knowledge about RouterOS `nv::message` ("M2"),
WinBox communication, and related formats in YAML that humans and tools can
read directly. It brings together public research, binary analysis, and
experiments against real RouterOS instances, with sources and confidence
recorded alongside each finding.

The schema is the deliverable: a reusable knowledge base, with research
probes and repo tooling alongside it. You can browse it without installing
anything. Schema content is **CC0-1.0**.

## Start here

- **Curious about how WinBox works?** Start with the
  [WinBox profile guide](profiles/winbox-ipc/README.md). It connects the
  transport, authentication, messages, and management handlers.
- **Decoding a packet capture?** Follow the
  [capture path in the agent map](llms.txt) to framing,
  authentication, encryption, and handler evidence. The proposed dissector
  and session-secret export still need implementation.
- **Investigating patched winbox.exe / winbox64.exe compatibility?** Follow
  the [compatibility path in the agent map](llms.txt)
  through the static patch review, client analysis, and canonical YAML.
- **Building a native WinBox backend?** Follow the
  [backend path in the agent map](llms.txt) to routing, typed fields,
  retrieval, pagination, writes, and notification gaps, plus existing
  implementation references.
- **Sending an agent here?** Use [the agent reading map](llms.txt) as a focused reading
  map. [AGENTS.md](AGENTS.md) contains contributor instructions.

## WinBox 3, RouterOS 7.25, and the current research

RouterOS 7.25 raised the minimum supported WinBox version to 4.3, prompting
[community discussion and attempts to keep WinBox 3 working](https://forum.mikrotik.com/t/please-continue-supporting-winbox-3-many-of-us-prefer-the-classic-ui/274042).
If that brought you here, the collected protocol evidence should help you
investigate beyond a client version check. Successful login or a working
menu alone does not establish full compatibility.

Our [forum discussion of possible future changes](https://forum.mikrotik.com/t/general-discussion-on-stable-releases-cut-off-from-7-25-stable-announcement-thread/274031/120)
is motivation for investigation, not a confirmed account of MikroTik's
roadmap. The initial lab work demonstrates authenticated native WinBox
queries on RouterOS **6.49.23 and 7.25**. Later attribute experiments include
**7.26beta4**, selected **7.26beta5** checks, and limited **7.16.2** hardware
observations; each YAML entry records its own scope. This does not establish
compatibility for every client, handler, device, or later RouterOS release.

The ongoing research combines WinBox client analysis with REA/Ghidra,
RouterOS binary analysis, and live probes using
[tikoci/quickchr](https://github.com/tikoci/quickchr). Findings have landed
in the canonical YAML: handshake corrections, session crypto,
version-scoped process identities, GUI handler/field mappings, native
retrieval and pagination semantics, the worker/shim process registry, and
the on-disk persistence rules for rows created over the protocol
(owner-token rows are reaped at boot; untokened rows persist).
The [WinBox profile guide](profiles/winbox-ipc/README.md) summarizes what
is known, in administrator terms. Follow the
[client analysis](work/2026-10-winbox-client-re/README.md) and
[CHR research](work/2026-10-chr-extraction/README.md) for the investigation
trail; the [live probe findings](work/2026-10-chr-extraction/ws3c-prober-findings.md)
record tested behavior and remaining gaps.
The [WinBox 3 patch review](work/2026-11-winbox3-patches/README.md)
connects version gates and GUI descriptor/parser breaks to that evidence.
It reviews sources statically; it does not verify patched client behavior.

That CHR-lab series (§§16–47 of the findings) is at a natural stopping
point: its remaining items need real RouterBOARD hardware, LTE/CAPsMAN/PPP
peers, or user credentials, or are small bounded residues. They are listed
as parked in the profile guide rather than chased further here. The
configuration-attribute follow-on has since produced a
[schema-aware experiment harness](work/2026-11-winbox-attributes/harness/README.md),
[sanitized replay fixtures](fixtures/README.md), and further YAML mappings.
Its [handoff](work/2026-11-winbox-attributes/handoff.yaml) records completed
batches and remaining work; the
[execution plan](work/2026-11-winbox-attributes/attribute-discovery-plan.md)
preserves the methodology and historical sequence.

## What this knowledge enables

[tikoci/centrs](https://github.com/tikoci/centrs) already consumes m2ir:
its shared EC-SRP5 implementation and regression vectors use this repo's
authentication findings for MAC-Telnet and bandwidth-test traffic. The
[implementation trail](profiles/winbox-ipc/README.md#existing-consumers-and-implementation-status)
pins the inspected revision and links source, tests, provenance, and status.
At that revision, WinBox terminal execution is still `not-started`; shared
authentication does not implement a native WinBox configuration backend.

Native WinBox data access is a further application of the
[GUI handler catalog](profiles/winbox-ipc/gui-handlers.yaml): which handler
owns a field, what its TLV (type-length-value) means, and how replies and
notifications behave. Retrieval, pagination, and selected write/persistence
experiments are recorded with per-handler limits; notification lifecycle
and wider handler coverage remain open. Compare efficiency by measuring
the target workload, including pagination, projection, and change handling.

Another goal is a **better Wireshark dissector for WinBox IPC**, with
schema-derived field names, context-aware handler decoding, and eventually
encrypted-session analysis when session secrets are available. The same
dissector could serve humans in Wireshark and agents through TShark's
structured output, supporting compatibility investigations and regression
tests. See the [dissector proposal](work/2026-10-winbox-dissector/dissector-proposal.md)
for the evidence, suggested milestones, and open decisions. Implementation
has not been committed to this repo or a separate project yet; the YAML
here remains the shared source of protocol knowledge.

## What is covered

| Area | Current coverage |
|---|---|
| [M2 wire grammar](physical/nv-message.yaml) | Headers, types, compact encodings, and nested messages |
| [WinBox IPC](profiles/winbox-ipc/) | Transport, EC-SRP5 authentication, session encryption, system/session keys, commands, errors, processes, and selected GUI handlers; see the profile guide for coverage counts |
| [The Dude on disk](profiles/dude-on-disk/) | Initial object-class and field catalogs, with upstream cross-checks |
| [WinBox CDB](profiles/winbox-cdb/) and [MNDP](profiles/mndp/) | Planned profiles; currently placeholders |
| [Cross-profile concepts](concepts/) | Planned semantic identities shared between profiles |

Coverage is incremental. A populated schema is not a claim that an entire
protocol is understood. Handler IDs and field meanings can depend on the
RouterOS version and context; check the evidence attached to the entry you
intend to use.

## Reading and contributing

The layers separate **bytes** (`physical/`), **meaning in a usage context**
(`profiles/`), and **shared semantic identity** (`concepts/`).
[DESIGN.md](DESIGN.md) explains the format and confidence levels. YAML is
canonical; the original [Kaitai strawman](profiles/winbox-ipc/strawman/)
is preserved as source evidence.

Protocol explanations belong in the schema's `notes:`, `evidence:`, and
`revision-history:` attributes. Exploratory findings and reproducible
research stay in [`work/`](work/) until ready to promote. Contributions
are most useful when they identify the tested version, preserve a source
or sanitized observation, and distinguish an observation from an inference.

See [BOOTSTRAP.md](BOOTSTRAP.md) for Bun setup and validation, and
[CREDITS.md](CREDITS.md) for the upstream work this reference builds on.

## Stable public entrypoints

For downstream skills such as
[routeros-skills#55](https://github.com/tikoci/routeros-skills/issues/55),
use these maintained URLs, then follow their links to current details:

- [README](https://github.com/tikoci/m2ir/blob/main/README.md) — mission and coverage.
- [Agent reading map](https://raw.githubusercontent.com/tikoci/m2ir/main/llms.txt) — the three task paths, schema, evidence, and tooling.
- [WinBox profile guide](https://github.com/tikoci/m2ir/blob/main/profiles/winbox-ipc/README.md) — human orientation, implementation references, and limitations.

Keep field tables, patch inventories, counts, and research status here.
Record the m2ir commit and exact RouterOS/client versions when using them;
`main` links discover current knowledge but do not pin a reproduction.
