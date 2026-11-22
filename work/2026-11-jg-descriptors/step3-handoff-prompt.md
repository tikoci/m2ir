# Step 3 handoff prompt: WebFig instrumentation

<!-- cspell:ignore jsproxy webfig quickchr autorefresh -->

Paste the block below into a new session started in the m2ir repo.

```text
Continue the declared-schema-first WinBox research in m2ir, plan step 3:
instrument WebFig to capture plaintext M2 from MikroTik's own client.

Setup
- Repo: m2ir, branch `jg-descriptors` (local only; do not push). Steps 0-2
  are committed (9753e98, 064c498, acb4833). Commit locally when a slice
  is done; keep `work/2026-11-romon/` out of commits (not ours).
- Read first: work/2026-11-jg-descriptors/plan.md (rules, step 3 section),
  handoff.yaml (state, decisions, leads), README.md sections "WebFig
  client model" and "Dialog conversation census". Then AGENTS.md and the
  .github/instructions/ files that apply to work/** and fixtures/**.
- Lab: quickchr instances twin3 (7.25), ws3c6 (6.49.23), winbox-beta4
  (7.26beta4); `quickchr start <name>`, HTTP on the listed port
  (twin3 = 9120). Stop every instance you start.

Goal
Capture, as plaintext JSONL, the messages WebFig 7.25 exchanges for the
Bridge workflow in plan.md (open Bridge = [20,0] rows with typevalue 12,
and Bridge Ports = [16,2]; identify a row by ufe0001; change its comment
0xfe0009 from a second session via REST or the native harness; observe
how WebFig learns of it; close and reopen). Then repeat on 6.49.23 and
7.26beta4.

What is already known (static, from 7.25 master.js)
- Messages are JS objects keyed by typed M2 keys (Uff0001 SYS_TO, uff0007
  SYS_CMD, ufe0001 STD_ID). A Session class does curve25519 then
  AES-128-CTR + HMAC over POST /jsproxy. Hook ABOVE the cipher: the
  post(req, cb) path / msg2buffer for requests, and the decrypted reply
  objects passed to callbacks and receive(). Notifications arrive through
  post_notification_request() (looks like a long poll; confirm).
- sessionStorage holds `name` and `password` after login (not a session
  key); WebFig logs in again from them. Seeding them should let a
  headless browser log in without the form.
- Predictions to confirm or refute (README table): lists always send
  CMD_SUBSCRIBE 0xfe0012 plus GETALL (getallcmd || 0xfe0004, STD_FILTER
  0xfe000c = 0x10000005 | refetchonopen | refreshfilter, 0xfe0018 =
  maxobjs, paging via 0xfe0003 / mfe0015); autorefresh adds timed GETALLs
  (Bridge Ports declares 2000 ms); notification rows carry _id, ufe0005
  next-id, ufe0013 removed, ufe0019 count; close sends CMD_UNSUBSCRIBE
  0xfe0013.

Approach (decided; adjust only with a stated reason)
- Headless browser driven by a reproducible Bun/TypeScript script in
  work/2026-11-jg-descriptors/webfig/ (Playwright is fine; the Playwright
  or Chrome DevTools MCP tools are fine for exploring first). An init
  script seeds sessionStorage and wraps the Session send/receive path,
  recording direction, timestamp and the message object.
- Do not reimplement the jsproxy crypto. A Bun-native jsproxy client is
  out of scope: it would be our client, not MikroTik's.
- WebFig assets and .jg files are MikroTik's: keep them in scratch or
  .scratch/, never commit them. Record their unique names / hashes with
  each transcript.

Outputs
- Capture script + README in work/2026-11-jg-descriptors/webfig/.
- Sanitized transcripts under fixtures/winbox-ipc/ following
  fixtures/README.md (no credentials; note RouterOS build, WebFig asset
  hashes, .jg unique names).
- README "WebFig client model": mark each prediction confirmed or
  refuted with the transcript reference.
- handoff.yaml: step 3 done/partial, step3-record, new leads. Promote
  stable facts into profiles/winbox-ipc/*.yaml (std-commands, std-keys,
  gui-handlers) with source: sample evidence; keep anything unsettled in
  work/.
- Gates before each commit: bun run lint, bun run test, markdownlint and
  cspell on touched files (add real vocabulary to GLOSSARY.txt).

Optional, if cheap in the same run
- Open an Ethernet interface's statistics in WebFig. .jg declares
  u64-array fields there (type letter Q, e.g. Q480 Tx Packets). If the
  decoded reply carries them, that supports wiring of tcode 0x90, which
  physical/nv-message.yaml calls declared-unwired (handoff.yaml lead).
  The JS object shows the decoded key letter, not the raw tcode, so
  record it as a lead for a native read, not as proof.
- Note whether 0xfe0026 (mfe0026, stripped by WebFig on row copy)
  appears in any reply.

Stop and report when the Bridge workflow is captured on at least 7.25
and the predictions are marked. Step 4 (native-harness replay as the
shared acceptance test) is the next session.
```
