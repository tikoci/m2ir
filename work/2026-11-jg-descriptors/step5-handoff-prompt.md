# Step 5 handoff prompt: WinBox 4 Bridge workflow

<!-- cspell:ignore quickchr omarchy usr -->

Paste the block below into a new session started in the m2ir repo on
orca. Phase 0 is a decision step; do not build capture infrastructure
before it is answered.

```text
Continue the declared-schema-first WinBox research in m2ir, plan step 5:
observe WinBox 4 itself running the Bridge workflow.

Setup
- Repo: m2ir. Steps 0-4b are on branch `jg-descriptors` (pushed; under
  review as their own checkpoint). Start step 5 on a new branch
  `jg-winbox4` from `jg-descriptors` and keep its commits there. Keep
  `work/2026-11-romon/` out of commits.
- Read first: work/2026-11-jg-descriptors/plan.md ("Step 5 handoff for the
  midpoint review"), handoff.yaml (next, step4-record, leads), README.md
  "Native replay (plan step 4)" and "WebFig client model", and the
  fixtures fixtures/winbox-ipc/7.25-{webfig,native}-bridge-workflow.*.
- Lab: quickchr twin3 (7.25, no extra packages) on orca. Stop every
  instance you start. Mutations go through requireMutationGate.

Known facts for phase 0
- orca runs omarchy with WinBox 4.4 (native Linux, /usr/bin/WinBox), so
  WinBox and the CHR can run on the same host without port forwarding.
  A Mac with WinBox exists; it is a second client build for later.
- The repo has the EC-SRP5 client side and the session cipher
  (work/2026-10-chr-extraction/ws3c/ec-srp5.ts, session-crypto.ts). A
  decrypting proxy also needs the server side (WinBox logs in to the
  proxy), which does not exist yet. The lab password is known.
- Without decryption, the router still reports WinBox's writes: the [17]
  history (work/2026-11-jg-descriptors/undo-lib.ts) shows each change's
  native request (m1) with source tcp-msg(winbox). That answers the MOVE
  arguments and comment SETOBJ shape, but not subscriptions or reads.

Phase 0 (time-boxed, about an hour): pick the capture method
Evaluate and record in README.md, then ask the user before building:
  A. Decrypting proxy on orca: server-side EC-SRP5 + the existing client
     side; WinBox connects to the proxy port. Estimate the work.
  B. [17] history only (no capture): which step-5 questions it answers.
  C. Client-side hooks on the Linux WinBox (LD_PRELOAD/gdb around its
     crypto or socket calls): feasible? does it reach plaintext?
  D. Whether WinBox 4 has any unencrypted or legacy login mode.
  E. Encrypted capture (tcpdump, or tikoci/tzsp-sniff on the router) for
     timing and message sizes only.
Recommend one, with what each leaves open.

Phase 1: the workflow (plan.md step 5, items 1-4)
- Drive WinBox by hand; script the second-session edits and the replay.
  Open Bridge Ports with two disposable port rows, idle across several
  refresh intervals, change a comment from a second session, close,
  change it again, reopen, move one port before the other, reopen.
  Mark each UI action in the timeline.
- Record WinBox build and OS, router build, package manifest, .jg unique
  names, and the capture method behind each observation.
- Deliver a sanitized, marked fixture and an offline check that rebuilds
  the displayed comments and row order, compared with the WebFig and
  native fixtures. If plaintext is not available, record the UI
  observations, the missing messages as open questions, and exercise
  the offline check on the existing fixtures.

Then (only if time remains): one recovery path, either a rejected edit
followed by a fresh read or a reconnect that rebuilds the list.
Gates before each commit: bun run lint, bun run test, harness tests,
markdownlint and cspell on touched files, and a fixture scan for lab
addresses and credentials. Update handoff.yaml (step5-record) and stop
with a report.
```
