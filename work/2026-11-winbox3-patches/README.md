# WinBox 3 patch projects for RouterOS 7.25 — review notes

<!-- cspell:ignore rodenasl masyanich peich1 mark99i mark1999 teslasystems rextended multinumber multicmdsrc bigfixedpoint bignumberrange biginterval enmbools strlen webfig amm0 amm0bot aslr rwx wbox iat svg png pngs tlvs poe vma rva jbe jmp chk hermes glm bigbytes shm interworking tos conv -->

Reviewed 2026-11-01. RouterOS 7.25 broke the classic WinBox 3.x client
(`winbox.exe` / `winbox64.exe` 3.43); the community produced three
patched variants. This note captures what each one is, what all three
agree RouterOS 7.25 changed, and where that knowledge would land in the
schema when drained. No binaries were downloaded or executed; claims
rest on repo README plus patch-script reads and forum post text.

For the maintained compatibility reading path, use the
[agent map](../../llms.txt) and
[WinBox profile guide](../../profiles/winbox-ipc/README.md). The promotion
map below identifies where findings would belong; it does not claim they
have been promoted or dynamically verified. Canonical YAML takes precedence
over this dated review. Record exact client hashes and RouterOS builds for
any later reproduction; native router probes do not exercise a patched GUI.

## Sources

- [WinBox 3 for ROS 7.25 — post #71 ("And then there were three")](https://forum.mikrotik.com/t/winbox-3-for-ros-7-25/274093/71) — enumerates all three variants.
- [7.25 stable release thread, posts #228–#236](https://forum.mikrotik.com/t/7-25-stable-is-released/273987) — authorship exchange for the rodenasl project.
- [Steering AI to use new manual.mikrotik.com](https://forum.mikrotik.com/t/steering-ai-to-use-new-manual-mikrotik-com/270916) — grounded-prompt lesson this review feeds.

## The three variants

### 1. mark99i / WinboxPatch (GitHub, deepest)

[mark99i/WinboxPatch](https://github.com/mark99i/WinboxPatch) (`master`
branch), by forum user mark1999. Patch sets v1–v5, deterministic and
SHA-chained from input `5b41cf51…07b6e9` (original 3.43) through p5
`84999acf…`, CI-built releases. v1 is 12 in-place `.text` patches
(282 bytes); v2 adds an embedded-icon `.wbox` section; v3 fixes Win11
launch plus Switch icon plus Format Drive guard; v4 adds
GNU-assembled bytes/bigbytes converter blobs (restores IPv4 Fragment
Threshold and Container shm-size editing); v5 adds 7.26/CMR crash
guards. Created with AI assistance (GLM-5.3). Notable extras beyond
the break list: an explicit VMA/crash-site map, a written WinBox4
bytes-grammar spec, icon provenance (webfig 7.24.5 PNGs, 7.26 inline
SVG raster), and a roadmap TODO naming open gaps (container ENV
render, ARP ping, wifi `interworking.realms-raw`, CMR slot/tags types).

### 2. rodenasl / winbox3-ros7-patch (GitHub, minimal)

[rodenasl/winbox3-ros7-patch](https://github.com/rodenasl/winbox3-ros7-patch),
attributed to forum user peich1 (claimed "my github" in the
release thread, post 228; URL supplied by rextended in post 231; reuse
granted in post 236 — no
explicit "I am rodenasl", so the linkage is strong but circumstantial).
One 244-line `patch_winbox.py`, 11 patches, one rule: skip what 3.43
does not understand instead of crashing. Each crash was reproduced
under a debugger against a 7.25 router. Same input SHA `5b41cf51…`,
output `ac408904…`; per-site original-byte checks plus output-hash
confirm. Code caves live in `.text` tail padding (VA
`0x531470`–`0x5315ff`); key sites match mark99i (version check
`0x0f991c`/`0x4fa51c`, skin skip `0x0f9d91`/`0x4fa991` — independent
corroboration. Icons load from a local `icons/` folder populated via
`--icons` from the WinBox cache.

### 3. Masyanich forum binary (binary-only)

Top-post `winbox64.zip` (893 KB) in the 274093 thread, AI-built
(Hermes + REA MCP per post #5). Core features plus Cyrillic claimed
working, not all settings; author refuses GitHub fearing a MikroTik
TOS violation. Near-zero catalog value beyond defect reports (red
IPv4 Fragment Threshold, spurious `interworking.realms-raw=""` on
WiFi save). A later `winbox-cmr.zip` restores connecting to
CMR-package routers but selecting the CMR menu item crashes.

## Agreed 7.25 break list (both READMEs)

1. Login reply advertises minimum WinBox version 4.3 — the *client*
   rejects the session itself (`jbe` → `jmp` bypass); the server still
   speaks the old protocol.
2. Router skins regenerated with new JSON constructs crash the 3.x
   skin parser; 7.25 never answers `skins/<name>.json`, so login hangs
   at "Downloading skin..." — patched by skipping user skins.
3. `.jg` menu-descriptor generator dropped redundant `title` fields
   (minification), so 3.43 calls `strlen(NULL)` in three places —
   patched with `title ?: name` fallback.
4. New field types (`bigfixedpoint`, `bignumberrange`, plus
   `biginterval`/`tags`/`tag`/`enmbools` per rodenasl), new conv type
   `u32_u32vector`, and Power-Cycle constructs (id-less `multinumber`,
   `multicmdsrc` reference-by-slot-number) hit 3.43 asserts — patched
   to skip/degrade.
5. Router no longer sends WinBox icon sprites (WinBox 4 has its own
   built in); finding credited to peich1.

Scoping note: these are client-parser and client-gate breaks, not M2
wire-grammar changes. The transport, handshake, and session-crypto
layers are unaffected as far as either project shows.

## m2ir relevance and promotion map

- Same target binary: both patchers take input SHA `5b41cf51…07b6e9`,
  the exact binary fingerprinted in
  [client-RE notes](../2026-10-winbox-client-re/README.md). The VMA
  maps corroborate each other and our oracle work.
- Promotion when drained (schema is the docs; this note is staging):
  - `profiles/winbox-ipc/gui-handlers.yaml` — handler/field notes for
    the field, conv-type, and parser breaks (items 3–4).
  - `profiles/winbox-ipc/processes.yaml` — version-observations for
    any pid/remap drift (none shown yet).
  - `profiles/winbox-ipc/sys-keys.yaml`, `std-keys.yaml`,
    `std-commands.yaml`, `std-errors.yaml` — only if envelope/verb
    drift is demonstrated (not shown).
  - `physical/nv-message.yaml` — only if a tcode/grammar change is
    shown (not shown; breaks are above the wire layer).
  - `fixtures/winbox-ipc/` — sanitized captures with provenance if we
    reproduce the 7.25 exchanges on CHR.
  - `test/profiles/winbox-ipc/` — Tier-1 replay tests mirroring
    `m2-replay.ts` for any promoted behavior.
- `CREDITS.md`: NOT yet — per
  [credits-maintenance](../../.github/instructions/credits-maintenance.instructions.md),
  sections are for sources drained into the schema (5+ `evidence:`
  entries), and these projects are reviewed, not drained. Add sections
  for both GitHub repos when the first promotion lands.
- Reverse direction: m2ir's schema entries (handler routes, SYS keys,
  CMD ids with confidence plus evidence), the 3.43 name oracle, the
  paired 6.49/7.25 fixtures, and the `m2-replay` anchor tests form a
  grounded-prompt kit for the *next* patch agent: pin IDs and offsets
  to cited entries instead of memory. Gap: client-RE addresses still
  live in `work/` notes, not version-scoped schema entries.

## Open items

- `interworking.realms-raw` contradiction: forum post #74 claims fixed
  vs mark99i roadmap TODO still open. No patched-binary behavior
  observed either way.
- mark99i `ANALYSIS*.md` files referenced by the build scripts are
  absent from the clone; releases `patched-v1..v5` binaries and icon
  PNGs never fetched.
- No dynamic confirmation in this review: patchers read statically only, no
  build, no patched EXE run against ROS 7.25/7.26.
- Masyanich zips never downloaded or executed.
