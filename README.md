# m2ir

`m2ir` is a unified schema for MikroTik RouterOS binary formats —
nv::message ("M2"), the WinBox app protocol, the saved-connections CDB
file, MNDP discovery, the Dude object store, and the JSProxy / RoMON
adjacencies. Same byte grammar shows up across many surfaces with very
different *usage*. The job of m2ir is to capture that knowledge once,
durably, in YAML that both humans and agents can read directly.

The format is the deliverable. Prose lives inside the schema (as
`notes:`, `evidence:`, `revision-history:`, `aka:`), not in adjacent
spec docs. See [`DESIGN.md`](DESIGN.md) for the principles, especially
the YAML-canonical / Kaitai-derived inversion and the
profile/concept/physical layering.

## Where things live

| Path | Purpose |
|---|---|
| [`DESIGN.md`](DESIGN.md) | Format principles. The one orientation doc. |
| [`physical/`](physical/) | Profile-agnostic wire grammars — `nv-message.yaml` drained; `mndp.yaml` pending |
| [`concepts/`](concepts/) | Cross-profile semantic identity (placeholder) |
| [`profiles/`](profiles/) | One subdir per usage context — winbox-ipc, dude-on-disk, winbox-cdb, mndp |
| [`profiles/winbox-ipc/`](profiles/winbox-ipc/) | First profile drained from the strawman: profile, transport, EC-SRP5 handshake, SYS/STD keys, commands, errors, processes |
| [`profiles/winbox-ipc/strawman/`](profiles/winbox-ipc/strawman/) | Original seed material (3 `.ksy` files + 1 semantic-overlay `.yaml`) preserved as evidence |
| [`fixtures/`](fixtures/) | Raw bytes referenced by `evidence:` (placeholder) |
| `src/tooling/` | Repo-local Bun tooling (instruction audit, `cortex.db` event log) |
| `test/` | Anchor tests for schema slices and tooling |
| `work/2026-05-m2ir-bootstrap/` | Imported design notes — promote out of `work/` only when stable, and prefer promoting *into the schema's prose attributes* |
| [`BOOTSTRAP.md`](BOOTSTRAP.md) | Repo plumbing — setup, lint, hooks, `cortex.db`, Kaitai |

## Status

v0.1 in progress. The seed strawman (one profile — `winbox-ipc`) has
been drained into canonical YAML; deeper sources still pending. Expected
next steps, roughly in order:

1. ~~Drain the `winbox-ipc/strawman/` content into canonical YAML under
   `profiles/winbox-ipc/` and `physical/nv-message.yaml`.~~ Done — see
   [`physical/nv-message.yaml`](physical/nv-message.yaml) and
   [`profiles/winbox-ipc/`](profiles/winbox-ipc/).
2. ~~Lift the Cisco-Talos `Winbox_Protocol_Dissector` Lua tables into the
   profile (SYS_*/STD_*/CMD_*/ERROR_* enums + the typeIDCode process-id
   table) at `confidence: documented`.~~ Done — the dissector's five
   tables (`commandCode`, `typeCode`, `statusCode`, `errorCode`,
   `typeIDCode`) are drained with line-range citations in each of
   `sys-keys.yaml`, `std-keys.yaml`, `std-commands.yaml`,
   `std-errors.yaml`, and `processes.yaml`. The handler-private command
   tables (mepty, mproxy, undo) are NOT in the Cisco-Talos dissector;
   they belong to step 4 (this project's PROTOCOL.md + MarginResearch).
3. Pull the donny `nova.ts` TAG/RANGE catalog into
   `profiles/dude-on-disk/` — the largest existing knowledge bank.
   Cross-check against [`german77/TheDudeToHuman`](https://github.com/german77/TheDudeToHuman),
   the older and more battle-tested decoder donny absorbed from.
4. MarginResearch + Tenable architecture facts into `winbox-ipc` and
   the seeds for `mproxy` and `undo` object classes.
5. Scaffold `concepts/` from the cross-profile values that fall out of
   the first two profiles.

The expected sources to drain (and why each matters) are listed in
`work/2026-05-m2ir-bootstrap/m2ir-design-review.md` §"What is already
known and ought to land in m2ir".

## License

CC0-1.0 for the schema content (maximum reuse and re-derivation).
