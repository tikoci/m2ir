# Declared-schema-first WinBox research plan

<!-- cspell:ignore typevalue jsproxy mrz webfig pollcmd cancelcmd startcmd getallcmd refreshfilter autorefresh -->

Status: approved 2026-11-21 after a review that combined Claude's and
Codex's proposals. [`handoff.yaml`](handoff.yaml) tracks progress.
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

## Steps

| # | Step | Output | Gate |
|---|---|---|---|
| 0 | Typed field identity in the schema, `lint-yaml.ts` and `schema-names.ts`; fix the f16 double entry | Schema rule, lint check, tests | Before any promotion |
| 1 | Promote `.jg` names and enums: NAT `action` first, then bridge rows and Bridge Ports. Settle the four conflicts in the README first | `gui-handlers.yaml` edits with `.jg` evidence | Step 0 |
| 2 | Census of the dialog conversation attributes (`startcmd`, `getallcmd`, `pollcmd`, `cancelcmd`, `getcmd`, `setcmd`, `autorefresh`, `refreshfilter`) against `std-commands.yaml` | Table in this directory | None (offline) |
| 3 | Instrument WebFig for the Bridge window (see below) | Sanitized plaintext transcript, first JSProxy notes | None |
| 4 | Acceptance test: replay the step 3 workflow with the native harness; compare with WebFig and with what `.jg` declares | Shared fixture for the client and the dissector | Steps 2 and 3 |
| 5 | Decrypting MITM proxy (EC-SRP is known); rerun step 4 with WinBox 4 | WinBox-specific behavior, such as subscribe vs poll | Step 4 |

The 470 7.25 routes with no handler wait until step 4 passes for Bridge.

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
