# profiles/winbox-cdb/

The WinBox client's saved-connections file. Same `nv::message` grammar
as `winbox-ipc/`, different field semantics, optional RC4-encrypted
variant. Magic varies by encryption state:

- `0d f0 1d c0` — open CDB
- `0d f0 11 40` — encrypted CDB

Discriminator is `recordType` on tag 1; record types include MAC target,
IP admin, IP user, and RoMON neighbor / target. The CDB profile is one
of the few places RoMON has a public, parseable shape.

Reference implementation: `~/Lab/centrs` `src/data/winbox-cdb.ts`.

Placeholder.
