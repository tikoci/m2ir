# Step 4b handoff prompt: `[17]` undo-history oracle

<!-- cspell:ignore quickchr restraml sfd002a -->

Paste the block below into a new session started in the m2ir repo.

```text
Continue the declared-schema-first WinBox research in m2ir, plan step 4b:
turn the [17] undo history into a REST/CLI -> M2 oracle for menus that
profiles/winbox-ipc/gui-handlers.yaml does not model yet.

Setup
- Repo: m2ir, branch `jg-descriptors` (local only; do not push). Steps
  0-4 are committed (step 4: e4a8f41, probe: 4358594). Commit locally
  when a slice is done; keep `work/2026-11-romon/` out of commits.
- Read first: work/2026-11-jg-descriptors/plan.md, handoff.yaml
  (step4-record, its optional-undo-oracle entry, leads), README.md
  sections "Native replay (plan step 4)" and "[17] undo history as a
  REST/CLI -> M2 oracle", and undo-oracle.ts (the 30-minute probe).
  Then work/2026-11-winbox-attributes/harness/README.md (pump.ts),
  profiles/winbox-ipc/undo.yaml, AGENTS.md and the .github/instructions/
  files for work/**, fixtures/**, profiles/**.
- Lab: quickchr twin3 (7.25), then winbox-beta4 (7.26beta4). Stop every
  instance you start. Mutations go through requireMutationGate.

What the probe showed (7.25)
- SUBSCRIBE [17] (0xfe0012) replays the whole history, then notifies
  new entries. Each row: S9 CLI text, Sa inverse CLI, s8 source,
  m1 native request, m2 native inverse.
- /ip dns set -> [14,2] CMD_SET u4; /snmp set -> [34] CMD_SET s2/s3;
  address-list add/set/remove -> [20,35] ADDOBJ/SETOBJ/REMOVEOBJ with
  u3=u4 address (u32 LE), sfe0010 list, sfe0009 comment, sfd002a "".
- For SET and remove, Sa and m2 carry the whole prior record, so CLI
  property names match typed keys by value.

Questions, in order
1. Reversibility and noise: does a SET to the current value record a
   history row? Does /undo (or native [17] 0x80007/0x80008, which WebFig
   uses) restore cleanly? Is the history length capped, and does
   SUBSCRIBE replay all of it? Pick the safest write per menu kind
   (singleton set, table add + remove, comment set).
2. Secrets: which menus put passwords, keys or secrets into S9/Sa/m1/m2
   (for example /user, /ppp secret, wireless or WireGuard keys, /snmp
   community)? Define a skip list and a redaction rule before any run
   that writes fixtures. Also redact the lab address in s8
   ("tcp-msg(winbox):admin@<addr>").
3. Menu selection: build the candidate list from the CLI tree (restraml
   7.25 inspect data or /console/inspect) limited to menus whose route
   is not in gui-handlers.yaml. Start with 20-30 menus across singletons
   and tables, then widen.
4. Name-by-value matching: for each menu, map CLI property -> typed key
   using m1 (the written fields) and the Sa/m2 full record. Report
   unique, ambiguous (equal values) and unmatched properties, plus
   encodings that need care (IP as u32 LE, arrays, enums as numbers,
   units like cache-size=2048KiB).
5. Cross-check with .jg: compare each m1 route and typed key with the
   .jg route and field ids (jg-parse.ts / jg-diff.ts). Count agree /
   .jg-only / oracle-only, and type-letter conflicts.
6. Version drift: rerun the same menu list on 7.26beta4. Check whether
   6.49.23 has [17] at all (6.49 has no REST, so use the native API via
   centrs for the writes); if not, record that.

Outputs
- A script under work/2026-11-jg-descriptors/ (extend undo-oracle.ts or
  replace it) and a generated report (markdown, like gui-handlers-vs-
  jg.md) with menu -> route, command, typed keys, CLI names, .jg match.
- A small sanitized fixture under fixtures/winbox-ipc/ (record shape as
  in the *-native-bridge-workflow.json files) plus a test under
  test/profiles/winbox-ipc/ that replays it and checks a few mappings.
- A written promotion rule (what evidence lets an oracle mapping enter
  gui-handlers.yaml, with which confidence and evidence source). Promote
  only a handful of routes as a demonstration; propose the rest.
- profiles/winbox-ipc/undo.yaml: what [17] is, its row keys and the
  subscribe/replay behaviour, with source: sample.
- handoff.yaml: step4b-record, new leads. README section.
- Gates before each commit: bun run lint, bun run test, harness tests,
  markdownlint and cspell on touched files (real vocabulary to
  GLOSSARY.txt), and a check that no fixture holds credentials or
  lab addresses.

Stop and report when questions 1-5 are answered on 7.25 and the
script, report, fixture and test are committed. Step 5 (MITM proxy for
WinBox 4) is the session after this one.
```
