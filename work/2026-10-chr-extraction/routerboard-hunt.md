# WS-3B working notes — `[24,17]` routerboard owner hunt (6.49.23 + 7.25)

Tool (this dir): [`rbscan.ts`](./rbscan.ts) — streams `objdump -d`
per ELF (no `/tmp` intermediates), groups `nv::message::insert` +
`ix` ops by function (`push %ebp` heuristic, as in `fields.ts`),
scores the routerboard signature per fn. Regenerable outputs:
`/tmp/rbscan-v6c.txt`, `/tmp/rbscan-v7b.txt`.

Target signature (from `profiles/winbox-ipc/gui-handlers.yaml`
`routerboard`, GET_ONE): strings {1,7,9,10,13,15,24,32} + u32:4
(nlevel) + **bool:16** (anchor — the single most distinctive member).

## 1. Census pre-filter: no 0x11 outside net/route, no bool:16 in sys2

- `/tmp/handler-census.txt` (46 binaries): only net (`0x11@80555b7`)
  and route (`0x11@80580c0`) register handler 0x11 — already ruled
  out (firewall RAW / route tables, see
  [`net-bridge2-handler-tables.md`](./net-bridge2-handler-tables.md)
  §4–5). sys2 registers 0x10 and 0x17 but NOT 0x11 (18
  `addHandler` refs in disasm = 17 sites + PLT; IDs certain).
- The scan below shows **no function in sys2 (either version)
  inserts bool:16 at any size** — a `[24,17]`-in-sys2 row builder
  is impossible on 6.49.23 and 7.25 as extracted.
- Process map has no `routerboard` process (only rbbios=61,
  keyman=65, both on disk) — the owner binary is not a missing
  package; the `[24,17]` attribution itself is suspect.

## 2. v6 sweep (69 ELFs with M2 traffic): no conjunction

bool:16 exists in exactly **7 functions across 5 binaries**, none
with any signature string:

| binary | fn | n | shape |
|---|---|---|---|
| bridge2 | 0x806db62 | 38 | known bridge-port superset |
| net | 0x80db15a | 57 | dense u32/bool table, zero strings |
| net | 0x80de986 | 21 | meta + numeric, zero USER strings |
| net | 0x80b4b62 | 61 | numeric + bools (ix-inclusive run) |
| net | 0x80c574a | 5 | tiny {u32:9,15, bools 16–18} |
| socks | 0x8054420 | 24 | one USER string (0x23) only |
| trafficgen | 0x805b290 | 17 | one USER string (0x2) only |
| ping | 0x804dad3 | 7 | tiny |

All other `RB?` hits are bool16=0 + u32:4 + ≤3 signature strings
(u32:4 is near-universal, so these are weak): cerm, discover
(be32/addr6 neighbor row — note it has STRING 0x10, not bool),
fileman, keyman (see §4), modprobed/moduler (same binary twice),
portman, quickset (5× unrolled loop), resolver, romon, vrrp,
watchdog. None exceeds 3/8 strings; none is board-shaped.

## 3. v7 sweep (75 ELFs): same verdict, two near-misses examined

- net `0x8166bcc` (bool16 + u32:4 + str {9,13}, n=12): only 2/8
  signature strings; sibling `0x805c2b8` is the same table minus
  bool:16 — a small net table, not RB.
- vrrp `0x804daee` (bool16 + u32:4 + str {9,13}, n=22): v6 vrrp
  `0x8050142` is the same table WITHOUT bool:16 — v7 gained
  {str:0x13, bool:0x10, be32:0x11, …}. Version drift of VRRP.
- diskd `0x80598a2` (n=176, str {1,7,9,15,24} = 5/8): a giant disk
  SMART table; field 4 is u64 not u32, bool:16 absent. Coincidence
  in a 176-insert table.
- All other v7 anchors (14 total) have zero signature strings.

## 4. Bonus: keyman builder = license-shaped, version-drifted

keyman `0x8050830` (v6, n=19): str {1,8,10,11,12,13} + u32:4 +
{bool:18, raw:20, u64:21, …} — contains the schema license core
{1:software-id/str, 4:nlevel/u32} plus extras. v7 keyman
`0x80520f2` (n=16) is the same table MINUS {str:1, str:8,
str:10}; str:1 moved to a tiny helper (`0x805341a`). Probable
license-row attribution (needs handler pairing to confirm).

Caveat: keyman imports **no** `addHandler` (0 refs) and owns no
`/nova/store/*` section — it serves no M2 handlers. So the
schema's license sys-to `[65]` is unloadable as stated (process
65 = keyman): either license is served by another process or via
an unmapped registration path. Flag for WS-4 alongside `[24,17]`.

## 5. Holes closed

- **ix-mutated rows** (interface-core pattern): re-ran with
  `message::ix` counted alongside `insert` — one new anchor (net
  `0x80b4b62`, no strings), verdict unchanged.
- **Split/small builders** (switch-dispatch singletons): full
  census of fns with n<8 touching any signature member — no
  binary shows an RB-signature helper family; sys2's small fns
  are unrelated pairs.
- **Loop-driven (register-id) inserts**: v6 console `0x807b70a`
  (all-`?`) and `0x806d764` are type-generic relay helpers (one
  op per tcode), not field tables. v7's `parser` binary (2392
  fns, 17K inserts — new in v7, CLI→M2 request builder) floods
  raw inserts with address immediates; register-id built, no
  fixed RB shape possible.
- **Frameless-fn merging** can only create false conjunctions,
  never hide a real bool:16+strings co-occurrence.

## 6. Verdict: still homeless — static wall confirmed

No single-fn insert/ix cluster matching
{strings 1,7,9,10,13,15,24,32 + u32:4 + bool:16} exists in **149
ELFs across both versions**. Combined with §1, `[24,17]` is not
served by sys2 on either version. Remaining hypotheses, in order:

1. **Schema sys-to is version-drifted or wrong** (observed-only,
   single-source): the `[24,17]` value came from a version whose
   layout differs, or misattributes another process/handler.
2. **Per-field helper dispatch** with call-graph indirection our
   fn-grouping cannot see (no evidence for; all sibling
   singleton getters insert inline).
3. **CHR x86 lacks the board path**: `/system routerboard` on
   real RouterBOARD hardware (MIPS/ARM) may live somewhere with
   no CHR-x86 counterpart.

Next: needs WS-3C live prober (`[24,17]` GET_ONE against booted
CHR — does it answer at all?) or client-side proof. Do not spend
more static effort here.

## 7. Follow-up: CHR==X86 correction + rbbios last mile (same day)

Correction (user): the CHR image and the X86 image are the same
bits; the code detects virtualization at runtime (cf.
tikoci/enbeep's test patch fooling CHR into X86 mode). So
hypothesis 3 in §6 as a *binary-absence* claim is withdrawn —
the board code should be (and is) in the extracted binaries.
What follows re-tests the hunt under that model.

**enbeep gate decoded** (`test/chr-beep.test.ts`, v7 sys2
`0x805c93b`): `cpuid; test %ecx,%ecx; js +0x14` skipping an
`insmod` call — i.e. CPUID.1:ECX bit 31 (hypervisor-present)
gates driver loading (ticker.ko for `:beep`). Runtime virt
detection in sys2 confirmed; pattern plausibly reused for other
hardware paths.

**Board code IS present**: v6 `rbbios` (31KB) owns the whole
board vocabulary (`got RB serial/model from BIOS`,
`RouterBOARD is not detected`, `current/upgrade firmware
version`, `/dev/mem` + `/proc/bus/pci/devices` + `/dev/csel0`
readers, fwf upgrade parser with a static field-name table at
`0x804e0b0`: version, build_date, serial_number,
routerboard_type, cfg_params, firmware_rbtype, …). v7 has NO
rbbios binary; the board-identity strings moved to v7 `mode`
(device-tree `/sys/firmware` paths, `Serial Number` formats).

**But the M2 last mile is still missing**:

- rbbios live M2 traffic = ONE `SYS_CMD=5` notify to sys2
  (`0x804ca63`) plus a *dead* table-driven emitter (`0x804d5bb`,
  bool/u32 by tag bits, 18-entry table, zero callers) plus the
  already-known dead insert cluster. Board values never enter
  an M2 row on this build.
- sys2 NEVER addresses process 61 (zero `$0x3d` in all of
  sys2's disasm); net's twelve `$0x3d` sites are field-id /
  policy / lstream args, none near `SYS_TO`. Nobody asks
  `[61,x]` anything — rbbios handlers are server-dead here.
- Generic-store path closed: sys2 `Store::set` ids are slots
  {0,1}, not field ids; keyman touches neither M2-server nor
  store APIs at all (pure crypto/serial client).
- Last-stone check — sys2 handler `0x10` (decimal 16, the
  off-by-one candidate): vtable `0x808f178` (derived over
  AHolder base), holder name **`/nova/store/chfont`** (console
  font), slot 9 = shared PLT getter. Not routerboard.

Corrected verdict: the user's model holds for *code presence*
(BIOS/board readers ship in the image; virt gating is runtime),
but no reachable M2 path serves `[24,17]` (or the RB field ids)
in either extracted tree. The remaining live hypotheses are
(1) schema sys-to/ids version-drifted (the entry is drained
from one private client implementation — see
`gui-handlers.yaml` header), or (2) the path activates only
with real RouterBIOS hardware (dead code on CHR). Both need
WS-3C: ask a booted CHR `[24,17]` GET_ONE and see who answers.

Bonus: `nova/lib/xmlnames2` (v6 only, 4KB ASCII) is the
`xml::xmlName` enum header — tag/attr names for `.x3`
decoding. Spot-checks match the cracked grammar: attr 7=PATH /
attr 4=ID (process-map record shape), root 33=LOADER,
41=NETREMOTE, 45=PCI, 51=PORTS, 53=SERVICES (a few roots don't
match by position — needs verification before use in
`x3parse.ts`).

## 8. Tool notes

- `rbscan.ts` argv: `[root] [bins…]`; v6 root is default. Output
  sections per binary: `RB?` (signature conjunction), `anchor`
  (every bool:16 fn, any size), `small(n)` (n<8 fns touching any
  member, compact), `top` (25 most insert-rich fns, deduped).
- u32-array tcode renders via a vector template: check
  array/vector substrings BEFORE `u32` when shortening, else
  arrays collapse to `u32` (caught by the vlan-builder check:
  `arr:1 u32:2 arr:3 arr:4 arr:5 arr:6`).
- `?` ids = register-passed (loop-driven) or miscaptured
  pointer immediates (v7 `parser` raw flood) — treat as "id
  unknown", not field-id 0.
