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
- **Building a client or investigating compatibility?** Read
  [the wire grammar](physical/nv-message.yaml) and
  [the WinBox profile](profiles/winbox-ipc/profile.yaml), then follow the
  relevant entries' `notes:`, `confidence:`, and `evidence:`.
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
roadmap. The current lab work demonstrates authenticated native WinBox
queries on RouterOS **6.49.23 and 7.25**; it does not establish compatibility
for every client, handler, device, or later RouterOS release.

The ongoing research combines WinBox client analysis with REA/Ghidra,
RouterOS binary analysis, and live probes using
[tikoci/quickchr](https://github.com/tikoci/quickchr). Findings have already
landed in the canonical YAML, including handshake corrections, session
crypto, version-scoped process identities, and GUI handler/field mappings.
Follow the [client analysis](work/2026-10-winbox-client-re/README.md) and
[CHR research](work/2026-10-chr-extraction/README.md) for the investigation
trail; the [live probe findings](work/2026-10-chr-extraction/ws3c-prober-findings.md)
record tested behavior and remaining gaps.

Our implementation interest is [tikoci/centrs](https://github.com/tikoci/centrs):
WinBox as a transport in its `--via` schemes. Terminal execution for
`centrs execute` provides a starting point. Native data retrieval and
listening for updates for `centrs retrieve` require a deeper understanding
of the attribute-based messages: which handler owns a field, what its TLV
(type-length-value) means, and how replies and notifications behave.
The [GUI handler catalog](profiles/winbox-ipc/gui-handlers.yaml) is a key
entrypoint for that work; retrieval and update semantics remain an active
research area. Maintaining a patched WinBox executable is outside this
project's scope.

## What is covered

| Area | Current coverage |
|---|---|
| [M2 wire grammar](physical/nv-message.yaml) | Headers, types, compact encodings, and nested messages |
| [WinBox IPC](profiles/winbox-ipc/) | Transport, EC-SRP5 authentication, session encryption, system/session keys, commands, errors, processes, and selected GUI handlers |
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
