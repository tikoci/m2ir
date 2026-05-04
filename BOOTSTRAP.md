# Bootstrap & repo plumbing

Operational notes for working *in* this repo. For what the repo is, see
[`README.md`](README.md). For the format design, see
[`DESIGN.md`](DESIGN.md).

## Setup

```bash
bun install
bun run hooks:install
bun run lint
bun run test
bun run build
```

## Helper scripts

```bash
# Show which instruction files apply to a repo path
bun run audit:applyto -- profiles/winbox-ipc/strawman/winbox-m2.ksy

# Manually append an event to the repo-owned SQLite log
bun run hook:log -- --source manual --event note --summary "bootstrap checkpoint"

# (Re)install the local git hooks for this repository
bun run hooks:install
```

## Git hooks

Hooks are wired through `package.json` scripts so the same entrypoints
are reproducible from the CLI:

- `.githooks/pre-commit` → `bun run hook:git:pre-commit`
- `.githooks/pre-push`   → `bun run hook:git:pre-push`

`.github/hooks/hooks.json` is wired to a dedicated Copilot hook handler
that reads JSON from stdin and writes nothing to stdout, so it stays
compatible with the documented hook behavior.

## cortex.db

`cortex.db` is the repo-owned SQLite log. Three streams, not one
generic table:

- `repo_events` — manual notes and generic internal events
- `git_hook_runs` — local git hook executions (command, status, exit
  code, duration)
- `copilot_hook_events` — documented Copilot hook payloads
  (`sessionStart`, `preToolUse`, `postToolUse`, …)

Treat it as repo-local working data: never log secrets, credentials, or
copied prompt text.

## Optional external tools

Kaitai is not required for normal lint/test/build loops. It is useful
when validating or regenerating the seed `.ksy` files under
`profiles/winbox-ipc/strawman/`:

```bash
brew install kaitai-struct-compiler
```

Long-term, Kaitai is downstream of the canonical YAML schema (see
`DESIGN.md` §2). The strawman `.ksy` files are *evidence*, not the
target form.
