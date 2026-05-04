# physical/

Profile-agnostic wire grammars. Each file describes how bytes turn into
typed values *without* picking names for those values — naming is the
profile's job (see `/profiles/`).

Two grammars are expected:

- `nv-message.yaml` — the M2 / `nv::message` TLV format. Shared by
  `winbox-ipc`, `dude-on-disk`, and `winbox-cdb`. Defines the 4-byte
  header, the tcode → payload-rule table, recursion via tcodes 0x28/0x29,
  and the split between the LE-internal and BE-framing-only parts.
- `mndp.yaml` — entirely separate TLV grammar (BE u16 tag/length).

Placeholder. Drained from `profiles/winbox-ipc/strawman/winbox-m2.ksy` and
`winbox-chunk.ksy` once those are reformatted as canonical YAML.
