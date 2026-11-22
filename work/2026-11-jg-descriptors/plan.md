# Declared-schema-first WinBox research plan

<!-- cspell:ignore typevalue jsproxy mrz webfig pollcmd cancelcmd startcmd getallcmd refreshfilter autorefresh -->

Status: approved 2026-11-21 after a review that combined Claude's and
Codex's proposals. [`handoff.yaml`](handoff.yaml) tracks progress; steps
0-4 are done (step 4 results: README, "Native replay (plan step 4)"), and
step 4b is done on 7.25 and 7.26beta4 (README, "`[17]` undo-history
oracle (plan step 4b)"). Step 5 is done on 7.25 with WinBox 4.4 Linux
through a decrypting proxy (README, "WinBox 4 Bridge workflow (plan step
5)", branch `jg-winbox4`); its recovery cases and the SUBSCRIBE snapshot
key followed (README, "WinBox 4 recovery cases"). Next: a second WinBox
build or 7.26beta4, then step 4c (handoff.yaml `next`).
[`README.md`](README.md) holds the `.jg` format notes and the first diff.

## Research question

Ask **"what does this RouterOS build declare a field means, and what must
a client do to use it correctly?"** instead of "what could this M2 field
mean?". The router serves its UI schema (`.jg`) and a working client
(WebFig). Field names, types, enums and declared commands come from those
first. Probes are kept for what neither source states: wire-only fields,
write semantics, rejection, update delivery, and version drift.

Scope each support claim to a client, operation, route, build and package
set. Step 4 establishes native harness behavior for the tested Bridge
workflow. Step 5 asks which operations WinBox 4 itself selects.

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
| 5 | Observe WinBox 4 running the Bridge workflow | Build-scoped trace and offline replay of WinBox-specific behavior | Step 4 |

The 470 7.25 routes with no handler wait until step 4 passes for Bridge.
Step 4 passed on 2026-11-21. Step 4b (added the same day, after the step 4
probe in the README) runs before step 5 and is the first pass over them.
Those 470 are base-package routes only: the 7.25 lab CHR had no extra
packages. Extra packages add their own `.jg` files (169 more routes on
the all-packages 7.26beta4 CHR), which step 4c covers.

## Step 5 handoff for the midpoint review

Start with one manually driven WinBox 4 desktop session against the 7.25
base-package CHR used for both existing Bridge fixtures. This is the
recommended first run. Record the exact client build and OS, router build,
package manifest, descriptor identifiers and how each observation was made.
Automate the second-session edit and offline replay first. Script the GUI
when a second build or repeated comparison makes that effort worthwhile.

1. Open Bridge Ports with two disposable port rows. Record their IDs and
   order, let the window sit idle across several refresh intervals, and
   change one comment from the second session. Close the window, change
   the comment again, and reopen. Mark each UI action in the timeline.
2. Move one port before the other. Record the order before and after and
   check it again after reopening. A successful reply alone was already
   shown to be an unreliable indicator of a move in step 4.
3. Compare the observed WinBox requests, replies and unsolicited updates
   against the existing WebFig and native fixtures. Identify the
   subscription word, any timed reads, how updates correlate to a row,
   the MOVE arguments, and what closing the window releases. Polling and
   notifications can coexist. Record both when the trace shows both.
4. Deliver a sanitized, marked fixture and an offline check that rebuilds
   the displayed comments and row order from the messages. A decoder
   should also expose direction, route, typed keys and unknown values so
   someone investigating a discrepancy can follow the same trace.

Check what the available capture can actually show before committing to
capture infrastructure. A desktop run can establish visible state and
timing. Claims about exact commands require plaintext evidence from that
WinBox session. If it is unavailable, record the UI observations and the
specific missing messages, leave those questions open, and use the two
existing fixtures to exercise the offline check.

After this slice, prioritize a client recovery case such as a rejected
edit followed by a fresh read, or rebuilding the list after reconnect.
Step 4c remains available when a package supplies the next consumer use
case. Keep broader history-derived mappings generated until a specific
decoder or client operation needs canonical evidence.

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
