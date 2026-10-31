# WS-3B working notes — sys2 (0x18) handler registration tables (6.49.23)

Binary: `~/.local/share/m2ir/extractions/root-6.49.23/nova/bin/sys2`
(32-bit x86, uClibc, stripped; 2791 procedures per REA).
Full disassembly used: `/tmp/sys2-asm.txt` (objdump, 85130 lines).
Getter dump: [`sys2-res-getall.asm.txt`](./sys2-res-getall.asm.txt)
(909 insns, `0x806a522`–`0x806b1c7`).

Method: static only — `nv::Looper::addHandler` call sites in `main`
(`0x8052aaa`, 10346B) give handler IDs; preceding
`movl $VT,(%reg)` after `malloc` gives the vtable; vtable rodata
(file off = VA − `0x808e2c0` + `0x462c0`) gives method pointers;
`nv::message::insert<T>(id, …)` / `get<T>(id)` call sites give
(field-id → tcode) pairs. Pattern per call (cdecl):
`push value; push $ID; push %msg; call insert<…>`.

## Registered handler IDs (17, from `main`)

`addHandler` sites at `0x8052dfd…0x807020c`, IDs (dec):
**0, 1, 2, 5, 6, 7, 8, 9, 10, 12, 14, 15, 16, 23, 24, 25, 31**.
8 paired to vtables below; 9 come from factory functions
(object in `%eax`/`%ecx`, vtable hidden inside the callee) —
their IDs are certain, their vtables are not yet recovered:

| id | vtable | note |
|---|---|---|
| 25 (0x19) | `0x808ea20` | — |
| 0 | `0x808e968` | same vtable as id 7 |
| 7 | `0x808e968` | same vtable as id 0 |
| 1 | `0x808ebb8` | **identity** — fully decoded, see below |
| 2 | `0x808ec40` | **resource** — fully decoded, see below |
| 31 (0x1f) | `0x808ecc8` | — |
| 8 | `0x808ed50` | — |
| 9 | `0x808f3b8` | — |
| 12, 14, 15, 16, 24, 10, 5, 6, 23 | (factory) | vtable TBD |

NOT registered by sys2: **17** — the schema's `routerboard`
`sys-to: [24, 17]` handler lives in another binary (candidates:
`routerboard`, `keyman`, `upgrade`). Open question for WS-3B-cont.

## Vtable layout (14 slots shown; 0-based)

Slots 2–8, 11, 13 are the shared `nv::Handler` base
(`0x8050940`, `0x8050d90`, `0x80521f0`, `0x8050bb0`, `0x8051510`,
`0x8051890`, `0x8051d50`, `0x8051980`, `0x8051370`).
Per-handler overrides:

| slot | role | identity [24,1] | resource [24,2] |
|---|---|---|---|
| 0, 1 | dtor / deleting-dtor | `0x80582da`, `0x805830e` | `0x8057d28`, `0x8057d9a` |
| 9 | get (bulk/select) | `0x8057f5c` | `0x806a522` (909 insns) |
| 10 | set | `0x80719a8` (real setter) | base `nv::Handler::cmdSet` (PLT `0x8051eb0` — read-only) |
| 12 | get-obj / sampler | base `nv::Handler::cmdGetObj` (PLT `0x8051180`) | `0x8061e8c` → sampler `0x8061e32` |

## [24,1] identity — CONFIRMED (schema 1/1 + types)

- Getter `0x8057f5c`: `get<u32>(0xfe000c)` (requested-field
  selector) then `insert<string>(12, …)` → **field 12 = name,
  string** ✓ (`gui-handlers.yaml` system-identity 12/name/string).
- Setter `0x80719a8`: `get<string>(12)` → `sethostname(3)` →
  `nv::Store::set(1, …)` → notify; failure path calls
  `nv::errorMsg(0xfe0006, …)` → **ERROR_FAILED = 0xfe0006** ✓
  (matches the WS-1A client oracle exactly).

## [24,2] resource — 19/19 schema fields CONFIRMED + 14 NEW fields

Getter `0x806a522` inserts 34 (id → tcode) pairs. Every schema
field is present with a matching type and a value source that
matches its name (see table). 14 fields are NOT in the schema.

Storage-type discriminator at obj+`0x84`: 1 = disk
(`/proc/diskstats`-style parse via `0x808e5e9`), 2 = NAND
(`/proc/yaffs` parse), 3 = neither (skips bad-blocks).
Write-sector total = since-reboot counter + persisted base
(obj+`0x88`, from `nv::Store`).

### Schema fields (all ✓, with binary value source)

| id | schema name/type | binary source |
|---|---|---|
| 1 | uptime / u32 | `nv::getUptime()` |
| 4 | cpu / string | `/proc/cpuinfo` line parse, per-arch formats (`vendor_id`, `model name`, `cpu model`, `cpu`, `Processor`; `e300`→`Freescale e300`); 2 insert sites = arch branches |
| 5 | cpu-frequency / u32 | sscanf `cpu MHz` / `core clock` / `clock : %d.` (last match wins) |
| 6 | cpu-load / u32 | avg of per-cpu window-B % over `ncpu`; inserted only if sum ≠ 0 |
| 19 | write-sect-total / u64 | since-reboot + persisted base |
| 20 | write-sect-since-reboot / u64 | yaffs `n_page_writes` accumulation / diskstats write sectors |
| 22 | version / string | `getOSVersion()` |
| 23 | bad-blocks / u32 | yaffs only: `bad×1000/(end_block−start_block)` (per-mille) |
| 24 | cpu-count / u32 | `(obj+0x80 − obj+0x7c)/8` ÷ 61 (0x3d jiffy-ring slots) |
| 25/26/27/44 | model / architecture-name / platform / board-name / string | handler-object strings +`0x64/0x68/0x6c/0x70` |
| 39 | build-time / string | `getOSVersion()` |
| 40 | total-memory / u64 | totalKB ≪ 10 (totalKB from `/proc/cmdline mem=%dM`, rounded fallback) |
| 41 | free-memory / u64 | freeKB ≪ 10 (`nv::getFreeMemory`) |
| 42 | total-hdd-space / u64 | `statfs("/rw/")` blocks × bsize |
| 43 | free-hdd-space / u64 | `statfs("/rw/")` bavail × bsize |
| 45 | factory-software / string | obj+`0x74`, inserted only if non-empty |

### NEW fields (14, absent from schema — WS-4 drain candidates)

| id | tcode | value formula | likely meaning |
|---|---|---|---|
| 2 | u32 | totalKB | total-memory, KiB (u32 legacy of 40) |
| 3 | u32 | freeKB | free-memory, KiB (u32 legacy of 41) |
| 9 | u32 | avg of per-cpu window-A % | second load average (always inserted; cf. 6) |
| 10 | u32 | f42 ≫ 10 | total-hdd, KiB |
| 11 | u32 | f43 ≫ 10 | free-hdd, KiB |
| 12 | u32 | `gettimeofday().tv_sec` | **server unix time** |
| 28 | u32 | (total−free) ≫ 10 | used-hdd, KiB |
| 29 | u32 | free×100/total (0 if total=0) | free-hdd, percent |
| 34 | u32_array | vector of per-cpu window-A % | per-cpu loads (`ncpu` elements) |
| 35 | u32 | totalKB ≫ 10 | total-memory, MiB |
| 36 | u32 | freeKB×10 ≫ 10 | free-memory, deci-MiB |
| 37 | u32 | f42 ≫ 20 | total-hdd, MiB |
| 38 | u32 | free×10 ≫ 20 (rounded) | free-hdd, deci-MiB |
| 46 | u32 | `nv::getJiffies()` | kernel jiffies since boot |

Load windows: per cpu, two jiffy-delta % are computed from the
61-slot sample ring (`imul $0x64 … div` = ×100/total); window A
feeds f34/f9, window B feeds f6. Exact window semantics (poll
interval vs boot) TBD — needs the `0x8061e32` sampler + timer
period, or live WS-3C data.

## Next

- Same method for `net` (0x14) and `bridge2` (0x10): `addHandler`
  sites → handler IDs → vtable → get/set slots → field tables.
  Then new-field naming pass for sys2's remaining 15 handlers.
- `[24,17]` routerboard owner hunt (grep `addHandler` + `$0x11`
  across `nova/bin/*`).
- WS-4 drain: 14 new resource fields, `ERROR_OK`=0 add,
  `STATUS_OK` rename, `SYS_DREASON` scoping.
