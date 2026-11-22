# Step 4 handoff prompt: native replay of the Bridge workflow

<!-- cspell:ignore webfig quickchr refreshfilter autorefresh -->

Paste the block below into a new session started in the m2ir repo.

```text
Continue the declared-schema-first WinBox research in m2ir, plan step 4:
replay the step 3 Bridge workflow with the native WinBox harness and
compare it with the WebFig transcripts and with what .jg declares.

Setup
- Repo: m2ir, branch `jg-descriptors` (local only; do not push). Steps
  0-3 are committed (step 3: 49df5bb plus the follow-up). Commit locally
  when a slice is done; keep `work/2026-11-romon/` out of commits.
- Read first: work/2026-11-jg-descriptors/plan.md, handoff.yaml
  (step3-record, leads), README.md section "WebFig client model (7.x
  master.js, tested in step 3)", webfig/README.md. Then
  work/2026-11-winbox-attributes/harness/README.md, AGENTS.md and the
  .github/instructions/ files for work/**, fixtures/**, profiles/**.
- Evidence to compare against: fixtures/winbox-ipc/7.25-webfig-bridge-
  workflow.jsonl and 7.26beta4-webfig-bridge-workflow.jsonl (cited by seq).
- Lab: quickchr twin3 (7.25), winbox-beta4 (7.26beta4), ws3c6 (6.49.23).
  Stop every instance you start. Mutations go through requireMutationGate.

Harness facts
- correlate.ts matches replies by SYS_REQID and stashes uncorrelated
  traffic in asyncSeen. There is no "listen for N ms" helper yet; add one
  if notifications need it.
- ws3c/m2.ts decodeM2 throws on tcodes 0x90 and 0xb0.
  webfig/m2-letters.ts decodes all 14 types; reuse it or extend decodeM2.
- 6.49 is in scope here: the native harness speaks to it. Use a second
  native session (not REST) as the "other client" there, and optionally
  on v7 as well.

Questions, in order
1. Notifications on the native transport. SUBSCRIBE 0xfe0012 to [20,0]
   and [16,2], change a comment from a second session, and capture what
   arrives unsolicited. Is it CMD_NOTIFY 0xfe000b with TO=[] and the
   same config-only row subset as WebFig (85/126 bridge, 38/66 port)?
2. Does 0xfe000c select content? GETALL [20,0] with 5, 0x10000005 and
   0x1004000f, and [16,2] with 5 and 0x10000007; diff the key sets. The
   profiles currently say this is untested; earlier legs found
   0/5/0x20000000 content-identical but never set 0x4000a or 0x2.
3. UNSUBSCRIBE 0xfe0013: does it stop notifications? (WebFig never
   sends it.)
4. Ordering and removal: with two or more ports, check that 0xfe0005
   (bridge-port f5, now next-id) chains rows, try MOVE 0xfe0007, and
   check removal rows {0xfe0001, 0xfe0013=1} and 0xfe0019.
5. Version drift: run 1-4 on 7.25, 7.26beta4 and 6.49.23.

Outputs
- A step 4 script under work/2026-11-jg-descriptors/ (or the harness),
  with a README section.
- A shared fixture under fixtures/winbox-ipc/ in the existing JSON record
  shape (hex + decoded entries), plus a test under test/profiles/
  winbox-ipc/ that replays it and checks it against the WebFig
  transcripts where they overlap (the plan's "shared fixture for the
  client and the dissector").
- Profiles: update client-usage / notes / evidence on 0xfe000b,
  0xfe0012, 0xfe0013, 0xfe000c, 0xfe0005, bridge-port and interface
  with source: sample. Mark each step 3 statement confirmed, refuted
  or still untested.
- handoff.yaml: step4-record, new leads.
- Gates before each commit: bun run lint, bun run test, harness tests,
  markdownlint and cspell on touched files (real vocabulary to
  GLOSSARY.txt).

Optional, time-boxed (30 min), only after 1-4
- [17] undo history as a REST/CLI -> M2 oracle. The step 3 transcripts
  show every change, including REST ones, recorded with its CLI text
  (S9), inverse (Sa) and the native M2 request (m1) and inverse (m2);
  see fixture seq 53. Make three or four CLI changes on menus that
  gui-handlers.yaml has no handler for, read [17] natively, and check
  that m1 names the route, command and typed keys. Report whether it
  is worth its own plan step; do not promote anything from it yet.

Stop and report when questions 1-4 are answered on 7.25 and the shared
fixture and test are committed. Step 5 (MITM proxy for WinBox 4) is the
next session.
```
