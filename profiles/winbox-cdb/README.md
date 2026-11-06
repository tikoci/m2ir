# profiles/winbox-cdb/

The WinBox client's saved-connections file. Same `nv::message` grammar
as `winbox-ipc/`, different field semantics, optional RC4-encrypted
variant. Magic varies by encryption state:

- `0d f0 1d c0` — open CDB
- `0d f0 11 40` — encrypted CDB

Discriminator is `recordType` on tag 1; record types include MAC target,
IP admin, IP user, and RoMON neighbor / target. The CDB profile is one
of the few places RoMON has a public, parseable shape.

Reference implementation, inspected centrs main revision
`0221b899da70b8c54410f357fd77c2133b286c08`:

- [CDB reader](https://github.com/tikoci/centrs/blob/0221b899da70b8c54410f357fd77c2133b286c08/src/data/winbox-cdb.ts)
- [Reader tests](https://github.com/tikoci/centrs/blob/0221b899da70b8c54410f357fd77c2133b286c08/test/unit/winbox-cdb.test.ts)

This profile remains a **placeholder**, without canonical field YAML.
The prose above is orientation; inspect the external implementation and
test provenance before relying on it. The
[source inventory](../../work/2026-05-winbox-nova-sources/winbox-nova-source-inventory.md)
adds WBX parsing and WBX/CDB conversion leads. Saved RoMON records do not
document the RoMON tunnel wire protocol.

For new evidence or a proposed schema drain, use the
[discovery submission path](../../README.md#submit-a-discovery). Saved
connections may contain credentials; submit sanitized minimal samples.
The [format and research index](../README.md) routes other file formats.
