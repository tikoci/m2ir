# WinBox IPC dissector proposal

Status: exploratory implementation proposal, 2026-10-31. A better WinBox
Wireshark dissector is a goal of the tikoci work that m2ir supports.
Whether the implementation belongs here or in another repository is open.
This note records a starting brief for future work, not a protocol spec or
an instruction to begin implementation. Protocol findings belong in the
canonical YAML, with their evidence and version scope.

## Feasibility and baseline

We appear to have enough evidence for a useful first release, followed by
incremental handler coverage. This assessment is against the
[Cisco-Talos dissector](https://github.com/Cisco-Talos/Winbox_Protocol_Dissector),
not an exhaustive audit of every current fork or alternative. Before
implementation, check those alternatives and decide whether to extend an
existing implementation or build a new consumer. Preserve applicable
upstream attribution and licenses when reusing code.

Talos already handles chunked messages, TCP reassembly, nested messages,
and common keys/commands. Its README explicitly limits support to
non-secure sessions. Meaningful improvements would include:

- Attribute interpretation scoped to process, handler, and known RouterOS
  version, instead of assuming a numeric tag has one universal meaning.
- Handshake/encrypted-envelope recognition, with payload decoding when
  appropriate session secrets are supplied.
- Request/reply correlation, routing, errors, and known retrieval shapes.
- Numeric IDs and raw values retained alongside semantic labels, with
  uncertainty visible for unknown or version-dependent meanings.
- Stable, filterable fields usable in both Wireshark and TShark.

Successful native queries against 6.49.23 and 7.25 establish a useful lab
baseline. They do not prove all WinBox clients, devices, handlers, or later
RouterOS versions behave identically.

## Existing foundations

Read these before adding another protocol implementation:

- [Physical grammar](../../physical/nv-message.yaml): types, compact
  encodings, lengths, nested messages, and byte order.
- [Transport](../../profiles/winbox-ipc/transport.yaml),
  [handshake](../../profiles/winbox-ipc/ec-srp5-handshake.yaml), and
  [session crypto](../../profiles/winbox-ipc/session-crypto.yaml): the
  TCP/8291 conversation, EC-SRP5, key derivation, envelopes, MAC, and padding.
- [GUI handlers](../../profiles/winbox-ipc/gui-handlers.yaml) and
  [profile index](../../profiles/winbox-ipc/README.md): selected field
  mappings, routing, key/command tables, and unresolved meanings.
- [Dissector shape builder](../../src/tooling/winbox-dissector-shape.ts)
  and [tests](../../test/tooling/winbox-dissector-shape.test.ts): an existing
  schema-to-data starting point for fields, enums, command spaces, and open
  questions. This is not a functioning Wireshark plugin; audit what metadata
  survives generation before relying on it for version-aware labels.
- [Live probe findings](../2026-10-chr-extraction/ws3c-prober-findings.md)
  and [prober](../2026-10-chr-extraction/ws3c/probe.ts): experimental
  implementation and decoded evidence from quickchr labs.

Generate semantic tables from YAML and keep Wireshark stream handling in
the consumer. Avoid a second hand-maintained field catalog. Unknown fields
should remain available for inspection without inventing semantics. Unknown wire types
whose lengths cannot be determined should stop that decode safely, rather
than guessing an offset and mislabeling everything after it.

## Encrypted sessions: the key dependency

The encryption algorithm is sufficiently described to implement decoding
with supplied key material. Obtaining that material is a separate task.
Our handshake derivation depends on an ephemeral private scalar; a passive
capture plus a known password is not generally enough to recover a session.

A practical lab path is an explicit opt-in secret export from the prober
or centrs, consumed by a dissector or preprocessing tool. This would be
analogous in purpose to TLS key logging, with a WinBox-specific format still
to design. Decide whether to export the shared secret or directional
AES/HMAC keys, and how to bind entries unambiguously to a connection and
client/server direction. There is no claimed existing standard or exporter.
An unmodified WinBox client's sessions need a separate extraction approach.

Without secrets, show the handshake and encrypted framing that can be
identified; do not claim to decode encrypted attributes. With secrets,
verify MAC and complete padding before accepting a decoded message. Report
missing keys, invalid authentication, malformed input, and incomplete
captures distinctly. Keep exported secrets local and out of repository logs
and committed artifacts; use sanitized lab fixtures without private device
data or reusable credentials.

## Suggested milestones

1. **Baseline and fixture audit.** Inventory current dissectors, review the
   shape builder, and define a small capture corpus with exact client and
   RouterOS versions, expected results, and provenance. Existing decoded
   transcripts help establish expectations but do not exercise packet
   reassembly by themselves.
2. **Plaintext M2 and semantic tables.** A Lua plugin is a candidate for an
   initial implementation. Support nested typed values, raw unknown fields,
   generated labels, and bounded parsing. Choose and document how decrypted
   messages enter the dissector; do not masquerade synthetic messages as
   original wire captures.
3. **Reproducible capture and conversation analysis.** Use quickchr and the
   prober for controlled sessions. Cover split/coalesced TCP messages,
   transport chunks, retransmissions, truncation, malformed lengths, nested
   data, multiple connections, and request/reply correlation. Test repeated
   dissection so revisiting packets does not corrupt conversation state.
4. **Secret-assisted decoding.** Define the export format and mapping,
   implement key consumption, and test valid, missing, wrong, and mismatched
   secrets plus corrupt MAC/padding. Decide between Lua with a supported
   crypto dependency, a native plugin, or an external decrypting tool after
   checking portability and supported Wireshark APIs.
5. **Broader semantics.** Expand selected handler fields and version-aware
   interpretation. Subscription/notification behavior needs its own evidence;
   recognizing a command name does not establish its complete lifecycle.

A useful initial acceptance gate is that the same sanitized fixture produces
expected typed fields in TShark, remains understandable in Wireshark, and
fails clearly on malformed input. Record the schema revision, plugin version,
and Wireshark version for reproducible results. Compare against independent
captures or another implementation as well as the prober, so matching bugs
in our encoder and decoder do not become evidence of correctness.

## Value to agents as well as humans

[TShark](https://www.wireshark.org/docs/man-pages/tshark.html) exposes packet
dissection on the command line, including display filters (`-Y`), JSON
output (`-T json`), and selected field output (`-T fields` with `-e`). An
agent can read saved captures without navigating the Wireshark GUI.

For this project, that suggests automated experiments: run an operation in
a CHR lab, capture it, extract relevant decoded fields, and compare expected
requests/replies across implementations or RouterOS versions. Packet numbers
and field values give a human a concrete way to verify an agent's conclusion.

Design filterable fields as an interface, rather than putting all useful
information in display-only labels. Keep raw IDs and values available, bound
output to the relevant conversation, and expose decode uncertainty/errors.
A dissector cannot supply missing session secrets or recover packets that
were never captured; an agent must retain those limits in its conclusions.

## Decisions deliberately left open

- Implementation repository, packaging, release cadence, and upstream strategy.
- Lua versus native code, and the placement of decryption support.
- Session-secret format and export integration with prober/centrs.
- Version selection when captures do not identify a reliable RouterOS version.
- Stable field naming and schema-version compatibility for downstream scripts.
- Minimum fixture coverage and platforms for the first supported release.
