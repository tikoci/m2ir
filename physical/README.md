# physical/

Profile-agnostic wire grammars. Each file describes how bytes turn into
typed values *without* picking names for those values — naming is the
profile's job (see `/profiles/`).

Two grammars:

- [`nv-message.yaml`](nv-message.yaml) — the M2 / `nv::message` TLV
  format. Shared by `winbox-ipc`, `dude-on-disk`, and `winbox-cdb`.
  Defines the 4-byte header, the tcode → payload-rule table, recursion
  via tcodes 0x28/0x29/0xa8, and the split between the LE-internal and
  BE-framing-only parts. Drained from
  `profiles/winbox-ipc/strawman/winbox-m2.ksy`.
- `mndp.yaml` — entirely separate TLV grammar (BE u16 tag/length).
  Placeholder until the MNDP profile is drained.
