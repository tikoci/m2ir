# m2ir agent entrypoint

Use this file as the repo-level pointer, then read the narrower rules in `.github/instructions/` before changing files those rules cover.

## Quick commands

- `bun install`
- `bun run lint`
- `bun run test`
- `bun run build`
- `bun run lint:ci`
- `bun run audit:applyto -- <path>`

## Repo map

- `src/protocols/winbox/schema/` — imported WinBox/M2 schema seed artifacts
- `src/tooling/` — repo-local Bun tooling (`audit:applyto`, `cortex.db` logging)
- `test/` — anchor tests for schema artifacts and repo tooling
- `work/` — exploratory protocol/design notes that are not yet hardened into stable specs
- `.github/instructions/` — durable path-scoped instructions; prefer these over expanding root guidance

## Working rules

- Prefer the most specific `.github/instructions/*.md` file for the path you are touching.
- Keep root `AGENTS.md` short and pointer-oriented; put durable path rules in `.github/instructions/`.
- Use Bun/TypeScript for repo tooling unless a narrower instruction says otherwise.
- Keep exploratory or imported research in `work/` until evidence justifies promoting it into `src/`, `docs/`, or tests.

## Verification

- Run the narrowest useful check while editing.
- Before finishing code or config changes, run the relevant repo gates from `package.json`.
- When changing docs/config plus code, prefer `bun run lint:ci` and `bun run ci`.

## Security

- Treat `cortex.db` as repo-local working data; do not log secrets, credentials, or copied prompt text into it.
- Keep imported protocol artifacts sanitized and avoid committing private captures or device-specific secrets.
- Prefer explicit failures over silent fallbacks in repo tooling.

## Do not

- Do not add broad repo-wide instruction prose when a narrower `applyTo` rule will do.
- Do not move raw bootstrap notes out of `work/` just to satisfy structure; promote them only when the content is actually stable.
- Do not introduce Node-only workflows when an equivalent Bun script already exists.
