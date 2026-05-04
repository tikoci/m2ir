# m2ir

`m2ir` is a Bun/TypeScript workspace for collecting, testing, and gradually formalizing a reusable intermediate representation for MikroTik binary formats.

The first bootstrap imports the current WinBox/M2 strawman from `~/Lab/winbox-terminal-protocol/schema/`: the parsable schema artifacts live under `src/`, the anchor tests live under `test/`, and the longer design notes stay under `work/` until they harden into stable repo-owned specs.

## Layout

| Path | Purpose |
| --- | --- |
| `src/protocols/winbox/schema/` | Imported WinBox chunk, EC-SRP5, M2, and semantic-overlay schema artifacts |
| `src/tooling/` | Repo-local Bun tooling for instruction audits and `cortex.db` event logging |
| `test/protocols/winbox/` | Anchor tests for the current WinBox/M2 schema seed |
| `test/tooling/` | Tests for the repo-local bootstrap tooling |
| `work/2026-05-m2ir-bootstrap/` | Imported design notes and exploratory context for the initial repo shape |
| `cortex.db` | Repo-owned SQLite database for lightweight local event logging |

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
bun run audit:applyto -- src/index.ts

# Manually append an event to the repo-owned SQLite log
bun run hook:log -- --source manual --event note --summary "bootstrap checkpoint"

# Install the local git hooks for this repository
bun run hooks:install
```

Git hooks are wired through package scripts so the same entrypoints stay reproducible from the CLI:

- `.githooks/pre-commit` -> `bun run hook:git:pre-commit`
- `.githooks/pre-push` -> `bun run hook:git:pre-push`

`cortex.db` now keeps three distinct streams instead of flattening everything into one generic table:

- `repo_events` for manual notes and generic internal events
- `git_hook_runs` for local git hook executions with command, status, exit code, and duration
- `copilot_hook_events` for documented Copilot hook payloads (`sessionStart`, `preToolUse`, `postToolUse`, and related events)

`.github/hooks/hooks.json` is wired to a dedicated Copilot hook handler that reads JSON from stdin and writes nothing to stdout, so it stays compatible with the documented hook behavior.

## Optional external tools

Kaitai is not required for normal lint/test/build loops, but it is useful when regenerating or validating the `.ksy` schemas:

```bash
brew install kaitai-struct-compiler
```
