# Phase B experiment harness (WinBox prober hardening)

<!-- cspell:ignore reqid -->

Experiment tooling for the attribute-discovery plan §B. Stays in `work/`
until the interface settles; the old `probe.ts` entrypoint is preserved.

## Modules

- `capture.ts` — lossless JSONL capture: exact plaintext bytes (full hex,
  never truncated), direction, order, reqid, routes, timestamps, decode
  errors. Unknown tcodes stop parsing explicitly; bytes are retained.
- `correlate.ts` — reqid-matched request/reply, async separation, bounded
  timeouts, explicit retries. Outcomes: `ok | router-error | timeout |
  decode-error | async-overflow`. Absent status stays absent, never assumed.
- `paging.ts` — GETALL token-chain walker (`0xfe0003` follow, bare first
  page, never `count=0`), loop detection, page bound, explicit
  complete/incomplete results.
- `schema-names.ts` — names from the canonical YAML with numeric fallback;
  tcode disagreement reported. Raw decode never depends on it.
- `target.ts` — quickchr target resolution with exact-version checks and a
  mutation gate (`allowMutations` + `disposable`, otherwise throw).
- `session.ts` — live SRP session as a `CorrelatedTransport` (throws on the
  MSCHAP-33 branch).
- `smoke.ts` — read-only live smoke: auth + identity GET + paged
  ip/address GETALL on a 7.25 CHR, JSONL manifest out. Never CI.
- `prove-identity.ts` — Phase C pilot slice 1: controlled identity
  renames via centrs (A/B/reverse) with native GET after each, a native
  SET probe of read-only field 13, an inverse native SET of field 12
  with independent read-back, and restore. Per-step JSONL manifests +
  `report.yaml` under `../proof/7.25-identity/`. Mutations need
  `--allow-mutations --disposable`. Never CI.

Fixed in the existing prober (`work/2026-10-chr-extraction/ws3c/`):

- `m2.ts` — encoder now covers every decoded tcode (`u64`, `bytes16`,
  nested `msg`, `bytes16`/`string`/`msg` arrays) with range validation;
  `0x80`/`0x90` refused as declared-unwired. No value masking.
- `probe.ts` — quickchr pinned (`QUICKCHR_PIN`, PATH binary,
  major.minor-checked; never `@latest`); `buildRequest` and `CMD_*`
  exported for reuse. CLI behavior unchanged.

## Checks

- `bun test ./work/2026-11-winbox-attributes/harness/` — 60 offline tests
  (hand-written byte fixtures, socket framing, correlation/paging fakes,
  schema naming, pilot replay). No CHR needed.
- `bun run lint` and `bun run test` — repo gates must stay green.
- `bun work/2026-11-winbox-attributes/harness/smoke.ts --quickchr twin3
  --out /tmp/smoke.jsonl` — live read-only smoke on a running 7.25 CHR.

## Local dependencies

- PATH-installed `quickchr` 0.5.x (matches `QUICKCHR_PIN` and
  `package.json`); a disposable 7.25 VM for `smoke.ts` only.
- No Ghidra, no running CHR for the offline tests or ordinary CI.
