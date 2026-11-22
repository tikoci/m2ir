# fixtures/

Sanitized evidence referenced from `evidence:` fields in the canonical
YAML. Per-profile subdirectories. Public-safe samples only — no
device-identifying secrets, no captured credentials.

## WinBox IPC replay evidence

[`winbox-ipc/`](winbox-ipc/) is populated with JSON fixtures containing
exact plaintext M2 hex and decoded entries. Provenance records the
RouterOS version, route, source experiment, and sanitization scope. These
are not packet captures: they do not include the TCP/chunk/encryption
conversation and cannot validate stream reassembly or session decryption.

Start at the YAML entry, follow its fixture and proof/report references,
then the corresponding test under
[`test/profiles/winbox-ipc/`](../test/profiles/winbox-ipc/). For example:

- [`gui-handlers.yaml`](../profiles/winbox-ipc/gui-handlers.yaml)'s
  `request-shape.get-all-paging` and
  [`std-keys.yaml`](../profiles/winbox-ipc/std-keys.yaml)'s `0xfe0003`
  lead to
  [`7.25-getall-20-1-cursor.json`](winbox-ipc/7.25-getall-20-1-cursor.json)
  and [`cursor-20-1.test.ts`](../test/profiles/winbox-ipc/cursor-20-1.test.ts).
- The `user-prefs-13-6` handler's SET evidence leads to
  [`7.25-set-13-6-populated.json`](winbox-ipc/7.25-set-13-6-populated.json),
  the Phase K proof directory, and
  [`k8-user-hunts.test.ts`](../test/profiles/winbox-ipc/k8-user-hunts.test.ts).

The tests decode bytes with the independent
[`m2-replay.ts`](../test/profiles/winbox-ipc/m2-replay.ts) helper and compare
decoded bytes with recorded fixture entries. They separately check selected
YAML fields; this does not establish exhaustive schema-to-fixture agreement.
Run an offline example from the repository root:

```bash
bun test ./test/profiles/winbox-ipc/cursor-20-1.test.ts
```

The [attribute handoff](../work/2026-11-winbox-attributes/handoff.yaml)
indexes completed experiments and remaining gaps. The
[harness guide](../work/2026-11-winbox-attributes/harness/README.md) documents
reproducible live probes and their dependencies/controls; replaying an
existing fixture does not constitute a new live observation.

### WebFig plaintext transcripts

`*-webfig-bridge-workflow.jsonl` record what MikroTik's own WebFig client
sends and receives during the plan step 3 Bridge workflow. Each file is
JSONL. Line 1 is the provenance: RouterOS build, WebFig asset SHA-256
hashes, `.jg` unique names, and the lab row ids. Each later line is one
event: a driver `mark`, a `tx` or `rx` message (WebFig's letter-keyed
object plus the exact plaintext hex), an `http` completion, or a `uri`
file fetch. The login password and session token are redacted. The
transcripts are compacted (`transcript.ts --compact`), so only selected
replies keep their full object and plaintext hex: every notification on
the workflow's focus paths and the first one elsewhere, and a non-notify
reply only when it is the first for its path since the last mark and is
on a focus path, or is the first ever for its path with at most 20 rows.
Router errors (`uff0008`) are always kept. Every other reply, including
some initial replies (for example seq 14 in the 7.25 file), is reduced
to its SYS routing keys, `ufe0003`, `ufe0019` and `row_ids` when it had
rows, with `"hex": null` and `"elided": true`. The transcripts are
therefore cannot be replayed message by message on their own. The
[capture guide](../work/2026-11-jg-descriptors/webfig/README.md)
explains the hook and how to reproduce a run; the
[findings](../work/2026-11-jg-descriptors/README.md#webfig-client-model-7x-master-js-tested-in-step-3)
cite these files by `seq`.

## MNDP evidence

[`mndp/`](mndp/) holds slices of the MNDP grounding lab: announcement
payloads by version and setting (with the observer's neighbor row where
the lab read one), request forms with how many routers answered and
whether a never-seen sender got a neighbor row, TTL by discover-interval,
the sanitized field-capture summary, and a versions index (which versions
each TLV and value was seen on, across every evidence payload).
[`make-fixtures.ts`](../work/2026-11-mndp-grounding/make-fixtures.ts)
regenerates them from `work/2026-11-mndp-grounding/evidence/`, and
[`mndp-profile.test.ts`](../test/profiles/mndp/mndp-profile.test.ts)
replays them against the YAML.

The Dude fixture collection remains unpopulated. Broader format
discovery starts at the [profile index](../profiles/README.md); a profile
placeholder does not imply a decoder or fixture corpus exists.
