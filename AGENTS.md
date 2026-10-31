# m2ir agent entrypoint

Read [`README.md`](README.md) for the mission and [`DESIGN.md`](DESIGN.md)
for the format principles before changing anything in `physical/`,
`concepts/`, or `profiles/`. For repo plumbing (lint, hooks, scripts),
see [`BOOTSTRAP.md`](BOOTSTRAP.md). Then read the narrower rules in
`.github/instructions/` for the path you're touching.

Use [the agent reading map](llms.txt) for a task-oriented reading map of the schema
and active research.

## Quick commands

- `bun install`
- `bun run lint`
- `bun run test`
- `bun run build`
- `bun run lint:ci`
- `bun run audit:applyto -- <path>`

## Repo map

- `physical/` — profile-agnostic wire grammars (`nv-message.yaml`)
- `concepts/` — cross-profile semantic identity (placeholder)
- `profiles/<name>/` — one usage context per directory; `winbox-ipc/strawman/` holds the imported seed material
- `fixtures/` — raw bytes referenced from `evidence:` entries (placeholder)
- `src/tooling/` — repo-local Bun tooling (`audit:applyto`, `cortex.db` logging)
- `test/` — anchor tests for schema slices and repo tooling
- `work/` — exploratory protocol/design notes that are not yet hardened
- `.github/instructions/` — durable path-scoped instructions; prefer these over expanding root guidance

## Working rules

- Schema is the docs. Prose belongs *inside* the YAML schema (`notes:`,
  `evidence:`, `revision-history:`, `aka:`), not in adjacent `.md`
  spec files. Do not grow a `docs/specs/` or ADR tree.
- Kaitai (`.ksy`) is not canonical. The strawman `.ksy` files under
  `profiles/winbox-ipc/strawman/` are evidence; the canonical form is
  YAML. See `DESIGN.md` §2.
- Prefer the most specific `.github/instructions/*.md` file for the
  path you are touching.
- Keep root `AGENTS.md` short and pointer-oriented; put durable path
  rules in `.github/instructions/`.
- Use Bun/TypeScript for repo tooling unless a narrower instruction
  says otherwise.
- Keep exploratory or imported research in `work/` until evidence
  justifies promoting it — and prefer promoting *into the schema's
  prose attributes* over promoting into another `.md`.

## Verification

- Run the narrowest useful check while editing.
- Before finishing code or config changes, run the relevant repo gates
  from `package.json`.
- When changing docs/config plus code, prefer `bun run lint:ci` and
  `bun run ci`.

## Security

- Treat `cortex.db` as repo-local working data; do not log secrets,
  credentials, or copied prompt text into it.
- Keep imported protocol artifacts sanitized; do not commit private
  captures or device-specific secrets to `fixtures/` or anywhere else.
- Prefer explicit failures over silent fallbacks in repo tooling.

## Do not

- Do not add broad repo-wide instruction prose when a narrower
  `applyTo` rule will do.
- Do not move raw bootstrap notes out of `work/` just to satisfy
  structure; promote them only when the content is actually stable.
- Do not introduce a `docs/specs/` tree, ADRs, or any documentation
  layout that re-fragments knowledge across many `.md` files. The
  schema entry is the documentation.
- Do not introduce Node-only workflows when an equivalent Bun script
  already exists.
