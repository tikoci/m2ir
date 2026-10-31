# WS-1A working notes — WinBox 3.43 client MapEntry tables

Binary: `scratch/winbox64.exe` (sha256 `5b41cf51…07b6e9`), PE x86_64.
Engine: REA 6.7.0 CLI + Ghidra 12.1.4 (`~/.local/share/ghidra/ghidra_12.1.4_PUBLIC`,
discovered via `~/.local/bin/ghidraRun` symlink; Temurin 25.0.5).
Snapshot: `winbox64.snapshot` (note: CLI re-imports per call, ~90s each;
`import_mode` is `ephemeral-source-immutable`, so batch queries).

## Overview (`winbox64-analyze.json`, ev_7206…)

13 segments, image base `0x400000`, **procedure_count 12286**
(matches WS-0 headless smoke), string_count 2735.

## `createEnum` (first blood)

`search … createEnum --kind procedures` → `0x43ecc1 createEnumEvent`,
`0x43ed03 createEnum`, `0x43ed38 createEnum`.

Dossier `fn-createEnum-43ed03.json` (`analyze_function`, 53 bytes):

```c
void createEnum(char **param_1)   /* _Z10createEnumPPKc */
{
  puVar1 = malloc(0x20);
  *puVar1 = &PTR_FUN_005a6968;
  *(undefined4 *)(puVar1 + 3) = 0;
  puVar1[2] = &PTR_LAB_005a69c8;
  puVar1[1] = param_1;            /* MapEntry table ptr stored at +8 */
}
```

Callers (tiny 9–12B stubs, each presumably binds one table):
`0x4d9500`, `0x4d97a0`, `0x4ff620`.

## Enum/table mechanisms (all confirmed)

- `createEnum(char const**)` (`0x43ed03`): NULL-terminated string-pointer
  array, index IDs. Instance: `0x532180` = `{"no","yes",NULL}`.
- `createEnum(MapEntry const*)` (`0x43ed38`): `MapEntry={id:u32,pad:u32,
  name:char*}` (16B, NULL-terminated). Instance: `0x535900` = filter
  operators (`contains`..`>=`, ids 0-9). Only 2 static tables of this
  shape in `.rdata` (other: BGP communities at `0x537340` with ids
  `0xffffff01..03`).
- `cenum(char const**)` (`0x47c970` + 10 more copies, all differ):
  strdup-based string enums. Instance: `0x5323b0` =
  `{"IPv4 only","IPv6 only",NULL}`.
- `getObjectMap(uint const*)` (`0x40e0a1`): `-1`-terminated uint key
  arrays into a runtime ObjectMap (`0x50bbe0`: key[0] selects sub-table,
  entries are 16B `{?,keyptr}`, match includes terminator). Static
  instances: `0x537a60`, `0x5321c0/0x5321d0`; 8 code call sites.
- `.rdata` FE table at VA `0x537cb0`: 6 IDs
  `[fe0004,fe0005,fe0003,fe0006,fe0007,fe0002]` + NULLs.

## The name oracle (`FUN_00428593`, 636B)

`(u32 ns, u32 id) -> name`, first-party ID↔name ground truth:

- `(0xff0007, *)`: CMD switch — `fe0000-08` NOOP..SETFORM,
  `fe000b` NOTIFY, `fe000d-16` GET..RESET (skips 09/0a/0c).
- `(0xff0008, *)` and `0xff0007`-default: ERROR switch — 0→`ERROR_OK`,
  `fe0001-07`, `fe0009-0e` (skips fe0008).
- `(0xff0003, 1/2)`: `TYPE_REQUEST`/`TYPE_REPLY`.
- `(0xff0004, 1/2)`: `STATUS_OK`/`STATUS_ERROR`.
- else: `inet_ntoa` + `"%d 0x%x %s"` numeric fallback.

IDs are also runtime-composed: `or $0xfe0000/%r15d` (and `fd`/`ff`
variants) at `0x42a2fd` — namespace base OR-ed with small indices.

## Verdict (`idscan.ts` → `id-name-diff.json`, 82 entries)

- **64 CONFIRMED** — std-commands (21/21) and std-errors (13/13 + new
  ERROR_OK) match the oracle 1:1; SYS_TYPE/SYS_CMD/SYS_STATUS confirmed
  by oracle dispatch + immediates + strings.
- **17 NAME-ONLY** — name in client strings, no static u32 (all
  `SYS_FROM/REQID/ERRSTR/USER/POLICY/CTRL/CTRL_ARG/USER_ID/NOTIFYCMD/
  ORIGINATOR/RADDR6` + 6 STD keys): consistent with OR-composed IDs.
- **1 ABSENT — `SYS_DREASON (0xff0016)`**: neither ID nor name in the
  client. Resolves the known delta: scope it server-side/other-version.

## Triage resolutions (tracker open items)

- `ERROR_OK`: client-attested, id **0** (`(ff0007,*)→"ERROR_OK"`);
  schema lacks it → WS-4 ADD.
- `SYS_COLUMNS_CNT`: client-internal only (string
  `"col >= SYS_COLUMNS_CNT"`, assert-like) → correctly out of schema.
- `STATUS_OK`/`STATUS_ERROR`: client names; schema says `OK`/`ERROR`
  under `0xff0004` values → WS-4 rename/aka (minor contradiction).
- `SYS_POLICY` values `0x5fffe/0x7fffe`: bitmask *values*, correctly
  absent as key IDs; stay `documented` (MarginResearch).

## 32-bit cross-check (`winbox.exe`) — IDENTICAL

Oracle at `0x427029` (517B): same 33 CMD/ERROR rows (same gaps at
`fe0009/0a/0c` CMD, `fe0008` ERROR). Full `idscan.ts` rerun:
64/17/1 with **zero per-entry deltas** (`id-name-diff-w32.json`).
WS-1A acceptance (zero unexplained deltas, both binaries) met.

## NAME-ONLY mechanism (wire-parsed IDs)

Whole-binary scan finds only 3 `OR r32, 0xXX0000` sites, all in one
function (`0x42a2d4-0x42a30f`): it reads a u16 index + 4-bit namespace
nibble from wire bytes and ORs base `0xfd/fe/ff0000`. The 17 NAME-ONLY
IDs (name string present, no static u32) are server-supplied over the
wire (e.g. `SYS_FROM` echoed back) or composed here — never materialized
as immediates. No further static hunt needed.

## Next

1. Dossier `0x50bd00`/`0x50bc50` (ObjectMap registration) for the
   ID→object construction side (optional; WS-1A verdict stands).
