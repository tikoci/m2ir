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

Dude and MNDP fixture collections remain unpopulated. Broader format
discovery starts at the [profile index](../profiles/README.md); a profile
placeholder does not imply a decoder or fixture corpus exists.
