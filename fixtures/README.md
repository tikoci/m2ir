# fixtures/

Raw byte sequences and sanitized captures referenced from `evidence:`
fields in the schema. Per-profile subdirectories. Public-safe samples
only — no device-identifying secrets, no captured credentials.

Placeholder. Likely first inhabitants:

- `dude-on-disk/clean.db.sample` — symlink or copy of donny's `clean.db`
  (224 builtin objects, no PII)
- `winbox-ipc/initial-request.hex` — the PROTOCOL.md §6 fixture already
  inlined into `test/profiles/winbox-ipc/m2-schema-anchor.test.ts`
- `mndp/discovery.pcap` — sanitized MNDP capture
