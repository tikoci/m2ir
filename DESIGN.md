# m2ir — design

## What this repo is

`m2ir` is an intermediate representation of MikroTik's binary protocol
family. The wire format ("nv::message", informally "M2" after its
`4D 32` magic) is shared across many RouterOS surfaces: WinBox IPC over
TCP/8291, the WinBox client's saved-connections file (CDB), The Dude's
on-disk object store (`dude.db`), RouterOS-internal IPC, mproxy,
suspected RoMON tunneling, and more. MNDP is a different TLV grammar
but conveys the same semantic values (identity, board, MAC, uptime).

The point of m2ir is to capture that knowledge once, durably, in a form
humans and agents can read directly and tooling can transform. Success
metric: an agent six months from now reads m2ir and gets the current
understanding faster than re-deriving it from MarginResearch, Cisco-
Talos, MUM talks, and assorted GitHub repos. Failure mode: the same
100k tokens get re-spent every time someone asks what `SYS_CMD =
0xFF0007` means.

## Principles

### 1. Schema is the docs

Prose lives *inside* the schema — in `notes:`, `evidence:`,
`revision-history:`, `investigation-trail:`, `aka:` — not in adjacent
`.md` spec files. A field is its own documentation, with citation. The
repo deliberately does not have a `docs/specs/`, `docs/adr/`, or
parallel ADR tree; if the answer to "where is X documented" is anything
other than "the schema entry for X", the format has failed.

This `DESIGN.md` is the one exception: a single short orientation doc
for *how the format is shaped*, not *what's in it*. It should not grow
into a spec library.

### 2. YAML is canonical, parsers are derived

Kaitai Struct (`.ksy`) is **not** the canonical artifact. The seed
material under `profiles/winbox-ipc/strawman/` includes three `.ksy`
files because that's how the work started, but Kaitai is being treated
as one possible *output* — alongside JSON Schema, TypeScript types, a
human-readable HTML doc, or a tiny bespoke parser per consuming
project. The durable artifact is the YAML schema. When evidence
changes, edit the YAML; tooling regenerates the rest.

Kaitai also can't represent the things that matter most: confidence
levels, evidence citations, revision history, alias relationships,
sentinel meanings, contextual discrimination. Those go in YAML
attributes. Treating Kaitai as canonical buries the actual long-lived
knowledge in compiler enums.

### 3. Profile-agnostic physical, profile-specific naming

The same byte grammar shows up with completely different *usage*. Byte
2 of an `nv::message` TLV header is `namespace` in `winbox-ipc` and
`marker` in `dude-on-disk`. Compact-length signaling differs. Object
classification differs (by `SYS_CMD` value vs. by leading-tag range vs.
by `recordType`). Trying to make one schema describe both ends in a
mess of conditionals.

Layering:

- `physical/` — wire grammar, profile-agnostic
- `profiles/<name>/` — names byte 2/3 according to local convention,
  binds tags to fields, declares its discriminator
- `concepts/` — cross-profile semantic identity (one IPv4 concept,
  bound from many profiles' fields)

Splitting from day one even if individual files are small. An agent
working on dude device fields should not also load MNDP and CDB
context.

### 4. Confidence and evidence are first-class

Every named entity carries a `confidence:` value:

- `documented` — named in a public source (Cisco-Talos dissector,
  MarginResearch, Mikrotik docs)
- `inferred` — derivable from documented facts
- `observed-only` — stable in real captures, no source explains it
- `guessed` — best-effort with no grounding; not to be trusted
- `superseded` — previous understanding now known wrong

Plus an `evidence:` list pointing at the source. Plus, when applicable,
`revision-history:` (we used to think X, we now think Y, here's why)
and `investigation-trail:` (we looked here on this date and didn't
find it, so future agents can skip the search).

Wrong entries are not bugs; they're prior beliefs with revision
history. The format makes that visible.

### 5. Discriminators are one mechanism, not four

Every profile faces the same problem: the meaning of one field depends
on another field's value (mepty handler dispatch, dude tag-range
classification, CDB recordType, MNDP per-tag). m2ir uses a single
`discriminator:` block — `source` (field-by-tag, leading-tag, computed,
transport-hint), `match` (exact, range, predicate), `variants` (each
points at a separate field-table file). The strawman discussion of this
lives in `work/2026-05-m2ir-bootstrap/m2ir-context-discrimination.md`
until it's exercised against two profiles and the proposal hardens into
the meta-schema.

## Layout

```text
DESIGN.md           # this file
README.md           # mission + how to navigate
BOOTSTRAP.md        # repo plumbing (cortex.db, hooks, lint, scripts)

physical/           # profile-agnostic wire grammars
  nv-message.yaml   # (placeholder)
  mndp.yaml         # (placeholder)

concepts/           # cross-profile semantic identity (placeholder)

profiles/
  winbox-ipc/
    strawman/       # imported .ksy + .yaml — the input to v0.1
  dude-on-disk/     # placeholder
  winbox-cdb/       # placeholder
  mndp/             # placeholder

fixtures/           # raw bytes referenced by `evidence:` (placeholder)

src/tooling/        # repo-local Bun tooling (audit, cortex.db log)
test/               # anchor tests for the schema and the tooling
work/               # imported design notes; promote to root only when stable
```

## What this DESIGN.md doesn't decide

These are open and worth deliberate design before scaling coverage:

- **Meta-schema**. A JSON Schema for m2ir itself (every field has the
  required keys, every `confidence: observed-only` has at least one
  sample evidence, every `references:` resolves). Worth building once
  the shape stabilizes across two profiles.
- **Where Kaitai sits exactly**. Useful generated output, or skip
  Kaitai entirely in favor of a tiny bespoke parser per consumer? Worth
  trying both before committing. Either way, not canonical.
- **Round-trip claim**. Per object class: `roundtrip: read-only |
  encode-fallback | full`. Donny tracks this implicitly; surfacing it
  here lets downstream tooling pick "use only fields I can re-encode
  losslessly".
- **Profile-level maturity**. Some profiles will start mostly
  speculative. A `maturity: stable | exploratory | speculative` lets
  consumers filter.

## Background reading

The long-form review and discrimination grammar that drove this design
live in `work/2026-05-m2ir-bootstrap/`. They are imported drafts, not
canonical. Promote material out of `work/` only when it is actually
stable — and prefer promoting it *into the schema's prose attributes*
over promoting it into another `.md`.
