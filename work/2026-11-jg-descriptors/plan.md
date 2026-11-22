# Declared-schema-first WinBox research plan

<!-- cspell:ignore typevalue jsproxy mrz webfig pollcmd cancelcmd startcmd getallcmd refreshfilter autorefresh -->

Status: approved 2026-11-21 after a review that combined Claude's and
Codex's proposals. [`handoff.yaml`](handoff.yaml) tracks progress; steps
0-4 are done (step 4 results: README, "Native replay (plan step 4)"), and
step 4b is done on 7.25 and 7.26beta4 (README, "`[17]` undo-history
oracle (plan step 4b)"). Next: step 5, then step 4c (handoff.yaml `next`).
[`README.md`](README.md) holds the `.jg` format notes and the first diff.

## Research question

Ask **"what does this RouterOS build declare a field means, and what must
a client do to use it correctly?"** instead of "what could this M2 field
mean?". The router serves its UI schema (`.jg`) and a working client
(WebFig). Field names, types, enums and declared commands come from those
first. Probes are kept for what neither source states: wire-only fields,
write semantics, rejection, update delivery, and version drift.

Field coverage is not client readiness. A route counts as supported only
when it passes the acceptance test in step 4.

## Rules

- **Typed field identity.** A field is identified by its type letter and
  its 24-bit key, plus the condition that selects the dialog (board,
  `typevalue`, version). A field number alone is not enough. Bridge f16 is
  two attributes (`u10` Region Revision, `s10` Region Name). License f12 is
  `sc` Serial Number on non-CHR and `uc` Level on CHR.
- Keep the broad `.jg` inventory generated. Promote individual findings
  into `profiles/winbox-ipc/*.yaml` with a `.jg` evidence entry and a
  version scope. Do not commit the raw `.jg` or WebFig files; they are
  MikroTik's.
- `/console/inspect` and Rosetta remain the bridge from a native field to
  the CLI name a RouterOS user knows.
- **Same package set across versions.** The router serves one `.jg` per
  installed package, so a version diff compares CHRs with the same
  packages, or only the `.jg` files both serve. Record the package list
  with every `.jg` set.
- **v7 first.** 6.49 is used only where it helps correlate a v7 finding
  (user, 2026-11-21).

## Steps

| # | Step | Output | Gate |
|---|---|---|---|
| 0 | Typed field identity in the schema, `lint-yaml.ts` and `schema-names.ts`; fix the f16 double entry | Schema rule, lint check, tests | Before any promotion |
| 1 | Promote `.jg` names and enums: NAT `action` first, then bridge rows and Bridge Ports. Settle the four conflicts in the README first | `gui-handlers.yaml` edits with `.jg` evidence | Step 0 |
| 2 | Census of the dialog conversation attributes (`startcmd`, `getallcmd`, `pollcmd`, `cancelcmd`, `getcmd`, `setcmd`, `autorefresh`, `refreshfilter`) against `std-commands.yaml` | Table in this directory | None (offline) |
| 3 | Instrument WebFig for the Bridge window (see below) | Sanitized plaintext transcript, first JSProxy notes | None |
| 4 | Acceptance test: replay the step 3 workflow with the native harness; compare with WebFig and with what `.jg` declares | Shared fixture for the client and the dissector | Steps 2 and 3 |
| 4b | `[17]` undo-history oracle: one reversible write per menu, read the history natively, map CLI path and properties to route, command and typed keys; cross-check with `.jg` | Generated mapping report, a sanitized fixture, promotion rules | Step 4 |
| 4c | Extra packages: a 7.25 CHR with `--install-all-packages`; fetch its `.jg`, diff per package file against the base set, then run the `[17]` oracle on package menus (restraml `extra/deep-inspect.json`) | Per-package route list, oracle mapping for package menus | Step 4b |
| 5 | Decrypting MITM proxy (EC-SRP is known); rerun step 4 with WinBox 4 | WinBox-specific behavior, such as subscribe vs poll | Step 4 |

The 470 7.25 routes with no handler wait until step 4 passes for Bridge.
Step 4 passed on 2026-11-21. Step 4b (added the same day, after the step 4
probe in the README) runs before step 5 and is the first pass over them.
Those 470 are base-package routes only: the 7.25 lab CHR had no extra
packages. Extra packages add their own `.jg` files (169 more routes on
the all-packages 7.26beta4 CHR), which step 4c covers.

## Step 4c: extra packages

Why: each package (container, dude, iot, user-manager, wireless, gps,
tr069-client, openflow, rose-storage, calea, ...) ships its own `.jg`,
so WinBox and WebFig gain routes when a package is installed. Neither
`gui-handlers.yaml` nor the oracle has looked at them, and the earlier
7.25 vs 7.26beta4 totals mixed packages with version drift (README,
"Result").

1. Start a 7.25 CHR with `quickchr ... --install-all-packages` (validated
   on 7.20.8+) and record `/system/package print`.
2. `jg-fetch.ts`, then count routes and field ids per `.jg` file; diff the
   base files against twin3's and the package files against
   winbox-beta4's (same packages, 7.25 vs 7.26beta4).
3. Run the `[17]` oracle on package menus, with the CLI tree from
   restraml `docs/7.25/extra/deep-inspect.json`. Some package menus hold
   credentials (user-manager users, container registry), so apply
   `SECRET_ARG` / `SKIP_MENUS` first and extend them.
4. Note which package each route belongs to in the report, so a handler
   entry can carry its package scope.

## Step 3: WebFig instrumentation

Findings from 7.25 `master.js`:

- Messages are JavaScript objects keyed with typed M2 keys, matching `.jg`
  ids: `Uff0001` SYS_TO, `uff0007` SYS_CMD, `ufe0001` STD_ID,
  `sfe0010` STD_NAME. Lists use `getallcmd`/`pollcmd`; saves default to
  `setcmd || 0xfe000e`.
- A `Session` class does a curve25519 key exchange, then AES-128-CTR with
  HMAC over `/jsproxy`. Hooking above the cipher yields plaintext without
  reimplementing any cryptography.
- `sessionStorage` holds `name` and `password` after login, not a session
  key. WebFig logs in again from those values.

Approach: a headless browser (Playwright) with an init script that seeds
`sessionStorage` with lab credentials and wraps the `Session`
send/receive path. It records each message object with direction and a
timestamp as JSONL. A Bun-native JSProxy client is a possible later
transport, but it would be our client, not MikroTik's, so it cannot
replace this step.

Bridge workflow, run on a disposable CHR and repeated on 6.49.23, 7.25
and 7.26beta4:

1. Open Bridge: the `[20,0]` rows with `typevalue=12`. Open Bridge Ports:
   `[16,2]`, which declares `autorefresh:2000`, `refreshfilter:2` and
   `ordered:1`.
2. Identify one row by `ufe0001`.
3. Change its comment (`0xfe0009`) from a second session, via REST or
   the native harness.
4. Record how WebFig learns of the change. Static reading of `master.js`
   (README, WebFig client model) predicts CMD_SUBSCRIBE plus GETALL, then
   a GETALL every 2 s because of `autorefresh`, with notifications as
   well. Confirm or refute it on the wire.
5. Close and reopen; record any cancel, unsubscribe or restart.

Record the RouterOS build, the WebFig asset hashes and the `.jg` unique
names with each transcript.

## Out of scope for now

- Passive TZSP capture (tikoci/tzsp-sniff) of encrypted WinBox sessions
  gives transport facts only. The semantic dissector works from the
  plaintext fixtures.
- Layout and the exact way each client interprets attributes. Neither is
  sent over the network.
