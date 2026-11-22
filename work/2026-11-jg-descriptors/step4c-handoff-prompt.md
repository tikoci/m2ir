# Step 4c handoff prompt: extra packages

<!-- cspell:ignore quickchr restraml userman5 -->

Paste the block below into a new session started in the m2ir repo.

```text
Continue the declared-schema-first WinBox research in m2ir, plan step 4c:
the .jg files and menus that RouterOS extra packages add.

Setup
- Repo: m2ir, branch `jg-descriptors`. Commit when a slice is done; keep
  `work/2026-11-romon/` out of commits.
- Read first: work/2026-11-jg-descriptors/plan.md ("Rules", "Step 4c"),
  handoff.yaml (step4b-record, next), README.md sections "Result" (the
  package-set correction) and "[17] undo-history oracle (plan step 4b)",
  then undo-menus.ts and undo-oracle.ts.
- v7 only. Lab: a 7.25 CHR started with `quickchr ... --install-all-packages`
  (validated on 7.20.8+); twin3 (7.25, no packages) and winbox-beta4
  (7.26beta4, all packages) for comparison. Stop every instance you
  start. Mutations go through requireMutationGate.

Known so far
- The router serves one .jg per installed package. twin3 serves 9 base
  files (498 routes); winbox-beta4 adds 10 package files with 169 routes:
  dude 42, wlan6 36, iot 30, cmr 22, container 14, userman5 14, oflow 5,
  netinstaller 4, gps 1, tr069 1.
- restraml has the package CLI tree in docs/7.25/extra/deep-inspect.json.

Questions
1. Which .jg file does each package install, and which routes and field
   ids does it add on 7.25? Record /system/package print with the set.
2. 7.25 vs 7.26beta4 with the same packages: route and field drift per
   file (jg-diff per file, or matched package sets).
3. Run the [17] oracle on package menus (no-op SET per property; add +
   remove only on menus without secrets). Extend SECRET_ARG / SKIP_MENUS
   first (user-manager users and secrets, container registry, ...).
4. Report each route's package so handler entries can carry a package
   scope; propose promotions under the README promotion rule.

Outputs: per-package route list, a mapping report for package menus, a
sanitized fixture + test if a new behaviour shows up, handoff.yaml
step4c-record, README section.
```
