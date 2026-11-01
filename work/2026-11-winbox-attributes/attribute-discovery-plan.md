# WinBox configuration attributes and verbs — execution plan

<!-- cspell:ignore llms cliref unsettable syscap rodenasl -->

Status: proposed execution sequence, grounded in repository and local-source
inspection on 2026-11-01, starting at commit `31b3f85`. This is research
planning, not a new protocol specification or a claim of completed mapping.
Canonical results belong in `profiles/winbox-ipc/*.yaml`.

## Pinned version decisions (2026-11-01)

- Third lab version is **7.26beta4** (not a stable 7.26): MikroTik kept
  changing the WinBox protocol after 7.25 broke WinBox 3.x support, and
  7.26.x follows those changes, possibly related to the 7.26beta CMR
  controller/device-manager feature (supported by centrs).
- Lab scope is 7.x divergence: 7.x below 7.25 versus 7.25-and-above
  (protocol behavior, not auth). No pre-6.43 legacy-MD5 proof target.
- `manual.mikrotik.com` page versions read as the latest patch in that
  series, or the beta/rc build where the source is 7.26beta4.
- WinBox 3.43 (Win32/64) refuses 7.25+ while Qt-based 4.x works both
  sides; community patch projects motivate the compatibility framing:
  mark99i/WinboxPatch, rodenasl/winbox3-ros7-patch, and the top-post
  binary in
  [Winbox 3 for Ros 7.25](https://forum.mikrotik.com/t/winbox-3-for-ros-7-25/274093/71).

## Outcome and boundaries

Make the schema useful for a native configuration UI and `centrs explain`:
given a version, handler route, operation, and TLV, explain its meaning,
representation, access, constraints, and evidence. Support the reverse
question too: which native operation and attributes implement this setting?
CLI names are aliases and experimental controls, not the identity of the
protocol. Preserve native fields and verbs that have no CLI equivalent.

The first deliverable is a repeatable discovery pipeline plus a small,
fully investigated configuration slice. Subsequent batches expand that
slice without redoing authentication, routing, or prior negative research.
Do not reopen the parked hardware/134/license/terminal work to begin this
phase. Notification behavior belongs in each tested operation's scope;
full notification coverage is not a prerequisite for mapping readable fields.

Read `README.md`, `DESIGN.md`, `llms.txt`, the profile guide, and applicable
`.github/instructions/` first. Then read the canonical physical grammar,
GUI handlers, SYS/STD keys, commands, processes, transport, handshake, and
session crypto. Findings notes are a trail, and can contain superseded claims.

## Source strategy

Use three complementary sources, preserving disagreements:

- **Rosetta and CLI reference:** names, descriptions, candidate types,
  conditional arguments, defaults, enums, access hints, and command paths.
  These define useful experiments, not numeric WinBox identities.
- **RouterOS and WinBox implementation evidence:** handler registrations,
  getter/setter paths, command dispatch, serialization, and enum conversion.
  Tie every address to a binary hash, architecture, and exact version.
- **Native WinBox observations:** exact requests/replies and controlled
  changes on disposable CHR instances. These prove what crosses this
  transport; CLI/REST observations independently check the resulting state.

MikroTik's [October 5 documentation changelog](https://manual.mikrotik.com/changelog/changelog-2026-10-05/)
explicitly describes regenerated CLI reference pages. Its
[August updates](https://manual.mikrotik.com/changelog/page/4/)
describe schema updates and changes to exposed type expressions. That
supports investigating structured source material. It does **not** prove
that the public reference contains handler IDs or WinBox TLV numbers, or
that one CLI argument maps to one attribute. Search public assets and local
source importers for such metadata in a bounded source-discovery task;
record a negative result rather than assuming a hidden numeric crosswalk.

### Existing work to reuse

- `work/2026-10-chr-extraction/ws3c/{chunk,m2,ec-srp5,session-crypto}.ts`:
  existing framing, codec, authentication, and crypto implementation.
- `work/2026-10-chr-extraction/ws3c/probe.ts`: native authenticated
  queries, scans, and write experiments. Extract reusable parts instead
  of starting another WinBox client.
- `work/2026-10-chr-extraction/ws3c/ev/` and
  `ws3c-prober-findings.md`: historical observations and controls.
  Preserve old artifacts; new runs need their own manifests.
- `handlers.ts`, `fields.ts`, `sys2-handler-tables.md`, and
  `net-bridge2-handler-tables.md` in that research directory: static
  registration/field leads. Pattern matches need function-level checking.
- `processes.yaml` and findings §38: v7 PR/HD registry and menu/store
  bindings. Extract a reproducible candidate inventory from the pinned
  binary; do not turn every menu binding into an assumed distinct handler.
- `work/2026-10-winbox-client-re/`: client enum/name evidence. The envelope
  name oracle is already investigated; bulk configuration discovery needs
  handler-specific evidence rather than another envelope-name sweep.
- `src/tooling/winbox-dissector-shape.ts` and its tests: existing
  schema-to-data adapter for fields and command spaces. Audit and extend
  it where suitable instead of maintaining a second naming inventory.
  `src/schema/m2ir.schema.json` is deliberately permissive; passing YAML
  lint does not establish semantic mapping correctness.

### Local Rosetta inspection and extraction starting point

Inspected read-only: `ros-help-0.12.0.db`, metadata release `v0.12.0`,
schema version `12`, source commit
`6b6397d7739a563b894f9b07f7ac2f6b1ad7f4bf`, build timestamp
`2026-10-30T21:34:20.911Z`. Recheck these before executing an extraction.
No numeric WinBox handler/field/verb identity columns were found in the
inspected schema or candidate samples. In particular, `schema_nodes.type_tag`
contains CLI enum type names, not numeric wire tags.

Useful tables and their boundaries:

- `cliref_pages` / `cliref_trees`: original source content, hashes, URLs,
  manual versions and fetch metadata. Trees are 7.24, 7.25, and 7.26.
- `cliref_entries`: source path/type, package, conditions, capability
  requirements, and source line ranges.
- `cliref_fields`: names, raw structured types, read-only classification,
  mandatory/unsettable metadata, conditions, descriptions, and source lines.
- `cliref_standard`: shared arguments deliberately omitted from menu pages,
  including comment, disabled, copy-from, and place-before.
- `cliref_flags`: printed flag meanings; these are not numeric wire bits.
- `schema_nodes` / `schema_node_presence`: inspect-derived CLI metadata
  and version presence. Node uniqueness is `(path,type)`; presence in this
  database covers 7.25 and 7.26beta4. The 104 `ros_versions` records do not
  imply detailed node presence for 104 source combinations.
- `cliref_entry_schema_links` / `cliref_field_inspect_links`: path and alias
  links. One property can join to arguments under multiple commands. The
  field-inspect view excludes read-only argument rows; failed joins are
  not proof that a native field is absent.

Normalize leading slashes for matching while retaining original paths.
Preserve raw type expressions: the `ip/address` source describes address
as a composite of address and netmask, an immediate clue to split-field
experiments. Completion examples such as interface names are observations
from an extraction context, not universal enum members.

Reproduce counts with these read-only queries (use `bun:sqlite` in the
planned extractor; `sqlite3 -readonly` is sufficient for manual inspection):

```sql
SELECT p.manual_version, count(*) AS fields
FROM cliref_fields f
JOIN cliref_entries e ON e.id = f.entry_id
JOIN cliref_pages p ON p.id = e.page_id
GROUP BY p.manual_version;

SELECT p.version, count(*) AS args
FROM schema_node_presence p
JOIN schema_nodes s ON s.id = p.node_id
WHERE s.type = 'arg'
GROUP BY p.version;
```

Observed CLI-reference counts: 7.24 = 10,758; 7.25 = 10,833;
7.26 = 11,284. The previously quoted 32,875 is their sum. Inspect argument
counts are 37,240 for 7.25 and 37,233 for 7.26beta4, with repeated property
names under different verbs. Neither source counts distinct native fields.

Pilot extraction query, preserving provenance and semantic hints:

```sql
SELECT p.manual_version, p.url, p.source_sha256,
       e.source_path, e.source_type, e.package, e.conditions,
       e.syscap AS entry_syscap,
       f.name, f.raw_type, f.field_kind, f.mandatory,
       f.unsettable, f.syscap AS field_syscap,
       f.source_line, f.description_markdown
FROM cliref_fields f
JOIN cliref_entries e ON e.id = f.entry_id
JOIN cliref_pages p ON p.id = e.page_id
WHERE p.manual_version = '7.25'
  AND e.source_path = 'ip/address'
ORDER BY f.source_order;
```

Also export the applicable `cliref_standard` records; this query alone
intentionally does not expand shared arguments or command aliases.

## Work packages and dependency gates

All new tooling uses Bun/TypeScript. Initially keep experimental tooling
and candidate records in this directory; promote reusable validated tooling
to `src/` with tests when its interface settles. The names below are planned
artifacts, not commands that exist today.

### A. Inventory and candidate ledger

Inputs: local Rosetta database, canonical YAML, existing transcripts,
version-scoped PR/HD data, and public CLI reference source metadata.

1. Open `~/.rosetta/ros-help-0.12.0.db` read-only using `bun:sqlite`.
   Record database hash, schema metadata, source URLs, source version,
   and query text. Database filename/version is not the RouterOS version.
2. Export a bounded candidate inventory for the pilot menus. Include
   shared standard arguments and per-command fields, deduplicate aliases
   without discarding their original source records, and keep version
   trees separate. Do not copy the database or bulk vendor prose into
   the CC0 schema; retain concise facts and precise citations.
3. Reconstruct native field tuples from schema and observations. Keep
   unknown fields, failed queries, and unsupported representations visible.
4. Join by version/menu candidates only to suggest experiments. Never
   join by spelling, ordinal position, similar values, or CLI type and
   declare the resulting numeric mapping proven.

Output: `source-inventory.yaml` and `candidates.yaml`, with reproducible
extraction commands and counts. Keep a separate status for each claim:
candidate, observed, discriminated, corroborated, promoted, contradicted,
or blocked. This workflow status does not replace schema `confidence:`.

Minimum ledger identity: exact RouterOS version/build, architecture,
package set, full route, command value, request/reply/notification role,
nested message path, namespace, and field ID. Record tcode and encoding
variants rather than flattening them into a type guessed from CLI output.
Fields with the same number on different handlers are different records.
Record CLI aliases as zero-or-more links; a single alias can reference
multiple fields and one field can serve multiple aliases.

Acceptance: the inventory can be regenerated; every pilot candidate has a
source and scope; unmapped CLI metadata is distinguishable from unmapped
wire fields; there is no fabricated global coverage denominator.

### B. Harden the existing prober into an experiment harness

Build this alongside A, then freeze a small shared interface before fan-out.
Audit the current implementation before extracting it. Known starting gaps:
`roundTrip` accepts the next message without request-ID correlation;
GETALL issues a single page; JSON byte rendering truncates at 256 bytes;
the encoder supports fewer types than the decoder; quickchr resolution
uses an unpinned `@latest`. Historical success is not a codec test suite.

The harness needs:

- A lossless capture layer for exact plaintext M2 messages before semantic
  decoding, plus direction, order, request ID, source/destination routes,
  timestamps, and decode errors. Preserve repeated fields, ordering, raw
  values, nesting, and unknown keys. An unknown tcode with unknown length
  must stop parsing explicitly while retaining the original message;
  never skip an invented length or reinterpret bytes to fit a candidate.
- Schema-derived names and context selection, with numeric fallback.
  Load the actual canonical YAML; report disagreement and absent coverage
  without mutating the schema or making raw decoding depend on known names.
- Correlated request/reply collection, asynchronous-message separation,
  bounded timeouts, tested retry behavior, and pagination with returned
  cursors, loop detection, and explicit complete/incomplete results.
  An error, timeout, empty list, and absent field are distinct outcomes.
- A capability inventory for decode and encode by physical type. Fill
  the pilot's encoder gaps first; refuse unsupported types explicitly.
  Validate numeric and length ranges before encoding rather than masking
  overflowing values. Preserve the old probe entrypoint while extracting
  its reusable session functions; failed commands/authentication must
  return unsuccessful status and a structured cause to batch callers.
  Preserve bytes separately from semantic re-encoding: equivalent compact
  encodings need not produce identical bytes unless original encoding is
  retained. Do not claim full round-trip support from decode success.
- An experiment runner: baseline, controlled mutation, observation,
  reversal, cleanup verification, and resumable results. Stop a shard if
  cleanup fails or transport output becomes incomplete.
- Explicit target/version checks and mutation opt-in limited to disposable
  lab instances. Pin quickchr and its invocation contract; the repo's
  dependency and an installed CLI may differ. Read quickchr/centrs skills
  at execution time. Use centrs for validated CLI/REST control operations;
  WinBox experiment traffic stays in this native harness.

Credential and artifact boundary: credentials/session keys remain local,
never command-line literals or committed transcripts. Capture only synthetic
lab data for promotion; omit authentication secrets and inspect decoded
content too. If sanitization alters bytes, retain provenance and label the
result a derived fixture, not the original capture. Raw binary/extraction
trees stay outside the repo as instructed by the CHR research README.

Output: capture/experiment format supporting replay, reusable harness modules,
offline tests, and a small live smoke report. Local external dependencies
must be documented; do not require Ghidra or running CHR for ordinary CI.

Acceptance before bulk probes:

- Known independent byte fixtures validate headers, compact and long
  lengths, nested arrays, repeated/unknown keys, truncation, and relevant
  scalar representations. Include negative length/bounds cases.
- Fragmented/coalesced transport, correlation, asynchronous replies,
  paging termination, and incomplete results have meaningful tests.
- Replay reproduces existing identity and IP-address observations using
  the canonical schema. Expected bytes are not generated solely by the
  encoder under test; otherwise a shared encoder/decoder bug can pass.
- A disposable 7.25 CHR smoke test authenticates and returns complete
  identity and list results; cleanup and manifest capture succeed.

### C. Prove the method on a small configuration slice

Start on **7.25** to reuse the grounded evidence. After the pilot passes,
repeat on **7.26beta4** (pinned 2026-11-01) to match source metadata;
record build/channel explicitly. Use 6.49.23 for targeted regression,
not as a mandatory blocker for every new v7 feature.

Pilot order:

1. `/system/identity`, route `[24,1]`: known string field and version
   response provide calibration. Change and restore the name; distinguish
   read-only version from writable configuration.
2. `/ip/address`, route `[20,1]`: use a synthetic address on an isolated
   lab interface. Exercise address/prefix decomposition, configured versus
   actual interface references, shared comment/disabled, add/set/remove,
   and empty/absent/default values. Existing schema supplies controls.
3. One previously unmapped configuration slice, chosen from A with static
   route evidence and a reversible CHR setup. Prefer an interface-list or
   bridge setting candidate; select its actual route rather than guessing
   from the CLI path. Include a nontrivial enum, reference, or bitmask.
4. One handler-specific action beyond standard CRUD, chosen only after a
   dispatch or native client trace identifies its numeric command. Prefer
   a harmless reset of a synthetic object's counters if supported. If none
   is grounded, finish the pilot with an explicit verb blocker and static
   dispatch evidence; never brute-force private command numbers.

For each writable candidate, run this experiment sequence:

1. Record initial CLI/native state and two unchanged native reads to
   identify volatile values; identify the object using a stable native ID,
   not a row index or assumed cross-transport ID equivalence.
2. Change one property through the independent control interface, choosing
   distinctive values A and B; collect complete native replies after each.
3. Reverse to A and repeat. Enumerate every changed field, including
   dependent/derived values; do not name the first changed TLV automatically.
4. Use discriminating controls: vary prefix without address, configured
   interface without unrelated state, one enum value or flag at a time.
   Test unset versus explicit default, empty versus absent, and disabled
   versus deleted. Do not erase volatile fields from the source artifact.
5. Once representation and target are grounded, perform the inverse
   native write and independently read the resulting configuration.
   Test add/set/remove separately; read visibility does not imply write
   support, and successful status alone does not prove state changed.
6. Restore state or destroy the disposable VM and record the outcome.
   Test reboot persistence only where claiming it for this operation;
   owner-token lifetime must be explicit in native create experiments.

For read-only/derived fields, replace write reversal with a controlled
stimulus or static data-flow evidence. For enums and bitmasks, prove the
numeric value mapping separately from the field identity. For nested or
polymorphic fields, record discriminators and parent context.

For every verb, record full route and numeric command, selector fields,
required/optional request fields, output fields, error replies, permissions,
side effects, completion semantics, and observed notification relationship.
Distinguish a native command from a CLI verb implemented as a field toggle
or several native operations. Never assume all handlers accept standard
commands identically or that a CLI `print` is one native GETALL request.

Acceptance: calibrations reproduce prior mappings, the new slice adds
discriminated evidence, the inverse-write checks pass for claimed writable
fields, and every unresolved association remains explicitly unknown.

### D. Schema promotion and consumer check

After C, agree a minimal representation using real examples before scaling.
Keep existing schema shapes where possible. Add operation-specific detail
under the appropriate handler in `gui-handlers.yaml`, or in `commands.yaml`
for private-command identity with handler context. If the file becomes
unmanageable, propose referenced per-handler YAML files in the profile;
preserve profile links and tests. Do not build a parallel Markdown spec.

Each promoted field/verb needs version scope, route/context, wire identity,
encoding, role, evidence, and confidence. Include units, sentinels, enum or
bitmask values, object-reference targets, defaults, conditions, access,
and aliases only to the extent established. Unsupported facts remain open.
Record prior wrong beliefs in `revision-history:`.

Use the DESIGN confidence vocabulary literally: a CLI name documented by
MikroTik does not make its WinBox numeric association `documented`.
Repeated live findings can remain `observed-only`; static derivations can
be `inferred`. A public source must actually name the wire association to
justify `documented` for that association. Evidence strength and workflow
status are separate from this vocabulary.

Output: canonical YAML patches, sanitized committed fixtures, narrow
schema/replay tests, and a small schema-driven consumer demonstration.
Show an explain-style result for a known read/write field, an unknown TLV,
a composite CLI alias, a version mismatch, and a handler-specific verb
(or its explicitly blocked status). Include evidence in explanations;
unknown mappings must not enable a UI write control. This is a local
consumer check, not a requirement to implement centrs or a complete UI.

Check artifact tracking explicitly: `.gitignore` currently ignores
`work/**/*.json` except selected old artifacts. New evidence must use a
deliberate tracked format or a narrow exception; never cite an ignored
local-only transcript as the reproducible evidence deliverable.

Acceptance: evidence references resolve, fixtures replay offline, version
and operation contexts select the correct meanings, and no decoder
hardcoded label is the sole reason a schema mapping passes its test.
Run the narrow checks during editing, then `bun run lint:ci` and
`bun run ci` for tooling/schema integration. Update credits when a new
major source is actually drained, not just because this plan mentions it.

### E. Expand in bounded parallel batches

Begin only after A–D establish the common formats and a successful pilot.
Prioritize common configuration surfaces with available CHR stimuli:
interfaces and bridges, IP addressing and routing settings, then firewall
and service settings. Hardware/peer-dependent fields get explicit blockers.
Keep configuration fields, status fields, and private actions distinguishable
in the backlog; prioritize UI/explain usefulness rather than raw row counts.

With four agent slots, use one coordinator and at most three workers:

- Initially: source inventory, harness, and static candidate analysis in
  parallel. The coordinator reconciles contracts and reviews source claims.
- After pilot acceptance: two independent handler-family research workers
  and one evidence/replay reviewer. Assign each worker disjoint artifacts,
  exact handler/version scope, and its own named VM/ports/configuration.
  Never share a mutable router or have concurrent workers edit the shared
  handler catalog. Workers submit evidence and proposed YAML fragments;
  the coordinator integrates canonical edits sequentially.
- At each batch boundary: freeze the candidate list, review contradictions,
  rerun relevant replays, integrate, update coverage, and choose the next
  batch. Use separate version checks to discover drift, not silently merge it.

Suggested default bound per worker: one handler family, at most ten
candidate properties and one private verb, two discriminating experiments
per unresolved association before review. An unresolved result becomes a
specific next experiment or blocker; do not repeat broad negative sweeps.
The bound is a review checkpoint, not permission to call a partial handler
complete. Continue follow-up batches until its declared scope is closed.

Every worker brief must specify inputs/commit, source versions, exact owned
paths and VM, hypotheses and controls, deliverables, acceptance checks,
mutation/cleanup scope, and stop conditions. Every handoff reports proven,
disproven, unknown, blocked, evidence paths, verification, and cleanup state.
The reviewer challenges correlated-but-unproven names and reconstructs
at least one new mapping from raw evidence independently of its label.

## Coverage and phase completion

Track version-scoped native tuples, not percentages of CLI argument counts:

- Candidate handler routes and which are reachable with the tested packages.
- Fields observed, named with evidence, writable with inverse proof, still
  unknown, and blocked; report newly discovered fields as denominator growth.
- Verbs identified, tested, and blocked, with request/reply coverage.
- CLI aliases linked, split across fields, or unmatched, as a separate metric.
- Evidence replay pass rate and version differences, with explicit counts of
  omitted/incomplete captures. Empty CHR tables do not establish completeness.

The first phase is complete when A–D pass for the three configuration slices
and the private-verb task has a proven result or a reviewed precise blocker,
with executable follow-up work in E. A handler batch is complete only when
every observed field and selected source candidate is classified, every
claimed mapping has evidence, and remaining gaps have bounded next steps.
Neither milestone means that all RouterOS TLVs have been enumerated.

## Ready-to-start assignment

Start A and B concurrently, plus static route/dispatch research limited to
C's third slice and private action. Do not run broad discovery writes yet.
The first integration checkpoint is the source ledger and offline harness
tests. Then execute C on a disposable 7.25 CHR, promote through D, and use
the measured results to select E's first two handler families.
