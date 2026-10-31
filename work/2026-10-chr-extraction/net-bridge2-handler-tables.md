# WS-3B working notes — framework + net/bridge2 handler tables (6.49.23)

Companion to [`sys2-handler-tables.md`](./sys2-handler-tables.md) (custom
handlers). This file covers the shared framework (`libumsg.so`), the
command dispatch, the namespace encoding, and the data-driven handlers
of `net` (0x14) and `bridge2` (0x10).

Tools (this dir): [`handlers.ts`](./handlers.ts) — addHandler→vtable→
slots→getter-inserts; [`fields.ts`](./fields.ts) — (tcode,id,op) index
and sibling-context queries. Both validated against ground truth.

Key disassemblies (regenerable, in `/tmp`): `net-asm.txt` (250K lines),
`bridge2-asm.txt` (77K), `rbbios-asm.txt`, `libumsg-asm.txt` (79K),
`libumsg-exports.txt` (856 demangled exports), `handler-census.txt`
(all 46 `addHandler` importers × handler IDs).

## 1. Framework (`libumsg.so`) — the rosetta stone

`nv::Handler::handleCmd(msg, cmd)` @0x28508 (256 insns). Dispatch:

```text
cmd -= 0xfe0000; if (cmd > 0x16) goto DEFAULT;
switch (cmd) via jump table (rodata 0x4b0a4, 23 entries)
```

| cmd | schema name | case | virtual slot |
|---|---|---|---|
| 0xfe0000 | CMD_NOOP | 0x28794 | — (empty reply) |
| 0xfe0001 | CMD_GETPOLICIES | DEFAULT | slot 19 (cmdUnknown) |
| 0xfe0002 | CMD_GETOBJ | 0x28589 | slot 12 + `get<u32>(0xfe0001)` obj-id |
| 0xfe0003 | CMD_SETOBJ | 0x285ad | slot 13 + obj-id |
| 0xfe0004 | CMD_GETALL | 0x285d1 | slot 14 + start/count, then slot-27 hook |
| 0xfe0005 | CMD_ADDOBJ | 0x28652 | slot 15 |
| 0xfe0006 | CMD_REMOVEOBJ | 0x28668 | slot 16 + obj-id |
| 0xfe0007 | CMD_MOVEOBJ | 0x28685 | slot 17 + obj-id |
| 0xfe0008/09/0a/0b/0f/10/11 | SETFORM/undef/undef/NOTIFY/START/POLL/CANCEL | DEFAULT | slot 19 |
| **0xfe000c** | **(schema gap!)** | 0x28737 | slot 20 = **`cmdShutdown`** (name from PLT symbols) |
| 0xfe000d | CMD_GET | 0x28547 | slot 9 |
| 0xfe000e | CMD_SET | 0x2855d | slot 10 |
| 0xfe0012/13 | SUBSCRIBE/UNSUBSCRIBE | direct | non-virtual `cmdSubscribe/cmdUnsubscribe` |
| 0xfe0014 | CMD_DISCONNECTED | 0x2872a | slot 24 = `cmdDisconnected` |
| 0xfe0015 | CMD_GETCOUNT | 0x28744 | slot 18 = `cmdGetCount` |
| 0xfe0016 | CMD_RESET | 0x28573 | slot 11 = `cmdReset` |
| out-of-range | (small ints, 0x100xx, 0x60001…) | 0x2876b | slot 19 = `cmdUnknown(msg, cmd)` |

Rules derived:

- Base `cmdGet/cmdSet/cmdGetAll/cmdUnknown` = `errorMsg(0xfe0003)`
  = **ERROR_NOTIMP**; missing obj-id = `errorMsg(0xfe0004)` =
  **ERROR_UNKNOWNID**. Command/error namespaces overlap numerically
  (context-dependent) — consistent with the WS-1A oracle finding.
- **0xfe000c = CMD_SHUTDOWN** (new command for WS-4; schema has a gap
  at 0x09/0x0a/0x0c — 0x09/0x0a are genuinely unhandled).
- SYS_CMD values outside `0xfe0000–0xfe0016` are **private per-handler
  sub-commands via slot 19** (`cmdUnknown`): small ints (rbbios→sys2
  cmd 5; sys2/net use 1,2,3,4,5,6,10), `0x10003/04/0a/0d`,
  `0x60001` (sys2 notify), `0x70001` (net). No global set<<16|cmd
  scheme — opaque per-handler values.
- GETOBJ-family object id = `get<u32>(msg, 0xfe0001)`; GETALL
  pagination = `get<u32>(0xfe0003, default −1)` (start) +
  `get<u32>(0xfe0004)` (count, clamped ≤ 1000 in ConfigHandler).

`ConfigHandler::cmdGetAll` @0x44518 (199 lines) — generic row assembly:

- Response envelope: **`0xfe0002: message_array[flat_row…]`**,
  optional `0xfe001d: message` (first row, flag-gated),
  **`0xfe0003: u32` = next-start-id** when truncated (>16KB cap).
- Rows = `getMsg(iterator, flags, 0)` per item (virtual,
  per-handler), flattened. Flags = `get<u32>(0xfe000c, default 5)`
  — **0xfe000c as FIELD = getall flags** (vs CMD_SHUTDOWN as command).

Slot map (dispatch + PLT-symbol cross-check):

| slot | method | slot | method |
|---|---|---|---|
| 9/10/11 | cmdGet/cmdSet/cmdReset | 18/19/20 | cmdGetCount/cmdUnknown/cmdShutdown |
| 12/13/14 | cmdGetObj/cmdSetObj/cmdGetAll | 21 | shouldNotify (helper) |
| 15/16/17 | cmdAddObj/cmdRemoveObj/cmdMoveObj | 24 | cmdDisconnected |
| 27 | getall post-hook (helper) | 35 | init/start (called directly) |

Slots 22/23 base names TBD (notify-related?). This map is V6-only:
v7's `nv::Handler` vtable shifts past slot 12 (new overloads +
cmdStopGetAll) — see §8.

## 2. Namespace encoding (wire `full_key = byte_2<<16 | key`)

| byte_2 | range | content |
|---|---|---|
| 0x00 | plain ids | USER per-handler fields (vlan 1–6, …) |
| 0x01 | `0x100xx` | NS-1: interface fields + private control plane |
| 0xfe | `0xfe00xx` | META/**SESSION**: row-id, comment/disabled, envelope |
| 0xff | `0xff00xx` | SYS envelope (0xff0001=SYS_TO, 0xff0007=SYS_CMD) |

Session mapping (schema `namespace:session` N ⟺ `0xfe000N`,
consistent with std-keys.yaml `SESSION_ID = 0xFE0001`):

- session:1 row-id ⟺ **0xfe0001** (GETOBJ target-id, getcount…).
- session:9 comment ⟺ **0xfe0009/string**; session:10 disabled ⟺
  **0xfe000a/bool**; session:7 dynamic ⟺ **0xfe0007/bool**.
  The triple co-occurs in row builders across net+bridge2 (33–40
  sites each). 0xfe0007-vs-0xfe000a (dynamic-vs-disabled) order TBD
  by value tracing.
- No `0x02xxxx` id exists in ANY binary (byte-scan over nova/bin +
  lib) — session is NOT byte_2=0x02. Schema text saying otherwise
  needs a WS-4 correction (or "SESSION" was always loose naming
  for the 0xfe meta range — verify against transport captures).

More 0xfe-field vocabulary (observed): 0xfe0008/bool,
0xfe000d/bool, 0xfe0010/string, 0xfe0012, 0xfe0014/u32 (count),
0xfe0015, 0xfe0019/u32 (getall hook result?), 0xfe001b/message,
0xfe001c/string_array, 0xfe001d/message (nested row).

Tcode notes: `be32_id` (big-endian u32 — ADDRESSES, see §4),
`addr6_id` (128-bit IPv6 = schema bytes_16), `raw_id` (≈ bytes),
4th accessor `message::ix<T>` (index/[] operator, in-place
mutation) alongside insert/get/has — `fields.ts` covers all four.

## 3. Handler census (46 binaries, `/tmp/handler-census.txt`)

Every `addHandler` id per binary recovered statically. Highlights:
net 79 handlers, route 86, bridge2 18, sys2 17 (no 0x11!),
rbbios 3. Only 2 unknown (quickset register-passed ids).

Process ids (v6): net=20, bridge2=16 (**0x10 IS bridge2 on v6** —
dude=103; Cisco-Talos conflict resolved for this version),
rbbios=61, route=44, quickset=120 (resolves the `[120] login`
conflict), mproxy=2.

## 4. Handler field tables

### bridge-vlan [16,13] — row-builder `0x806df36` (91 insns)

| id | tcode | schema | verdict |
|---|---|---|---|
| 1/2/3/5 | u32arr/u32/u32arr/u32arr | vlan-ids/bridge/tagged/untagged | ✓✓ ALL MATCH |
| 4, 6 | u32_array | — | NEW (configured-vs-current tagged/untagged?) |
| 0xfe0007/0xfe000a/0xfe0009/0xfe001c | b/b/s/s[] | session 7/10/9 | ✓ meta-shape match |

ATTRIBUTED: `/nova/store/bridge-vlans` → handler 0xd (store census).

### bridge-port [16,2] — candidate `0x806db62` (38 inserts)

Superset incl. `u32:3, u32:4, u32:19` (interface/bridge/pvid ✓ types
match) + ~30 more (1,2,5,10–18,20–31,208,216,220…) + meta. A second
`{3,4}`-shaped fn (`0x8056068`, 12 ops, no 19) is something else
(request/notify side?). Port attribution: probable (shape +
handler-2-custom consistent). Bridge2-2/13 slot-9 getters are
REQUEST-BUILDERS (proxy/join: SYS_CMD + `0x1003b/0x10001` +
`string(0xfe0009)` + `u32(1)`) — sub-request targets TBD.

### interface [20,0] — row-core `0x80f6738` (810 insns, 75 ops, LIVE)

| schema field | full_key | tcode | sites | verdict |
|---|---|---|---|---|
| 5 default-name | 0x10005 | string | 4 | ✓ (ix in core) |
| 6 name | 0x10006 | string | 16 | ✓ (ix in core) |
| 14 running | 0x1000e | bool | 1 | ✓ (ix in core) |
| 30 type | 0x1001e | string | 1 | ✓ (ix in core) |
| 101 l2mtu | 0x10065 | u32 | 5 | ✓ (ix in core) |
| 105 actual-mtu | 0x10069 | u32 | 1 | ✓ (ix in core) |
| 1001 mac | 0x3e9 | raw | 7 | ✓ (has+ins in core) |

ALL SEVEN converge on one live fn (+ `0xfe0001/0xfe0009/0xfe001c/
0xfe0007` session-meta + private `0x10001–0x10104`). NOTE `0xfe000a`
is absent from all 75 ops (peer `0xfe0007` present) — disabled may
arrive via generic store-walk. net-0 vtable `0x8113888` (ctor
`0x8104f82`, obj 0x1e8 B; `handlers.ts` CANNOT pair this one — the
vtable install is inside the callee, factory-style): slots 9–17/20/24
= base (NOTIMP etc. — all 17 PLT-resolved, see §8), local 7 =
**handleCmd OVERRIDE** `0x80d1af8` (custom dispatch — GETALL never
reaches base slot 14!), 18 = getcount `0x805bcec`
(→ `u32(0xfe0014)`, honors the §8 GETALL filters), 19 = cmdUnknown
`0x80d2f80` (800+ insns, private cmds 2–12 + `0x100xx`), 21 =
shouldNotify-filter, 22/23/26/27/28/35 local helpers. net-0 owns
`/nova/store/net/devices` (+ `/rw/store/…` persisted). Handler-0
attribution: CONFIRMED (store ownership + live rows match the core +
the §8 GETALL worker serves interface rows).

### ip-address [20,1] — candidate `0x80ae18e`

`{be32:1, be32:2, be32:3, be32:4, u32:5, u32:10}` + meta vs schema
`{1:u32, 3:u32, 5:u32}`: field SHAPE matches (1/3/5) but address+mask
are **be32 (big-endian)**, not u32-LE — schema byte-order suspect
(needs live/client proof). Extras (2/4/10) = broadcast/network/?.
A second addr-table `0x805a760` (`be32:1, raw:2, u32:3, bools`)
is probably firewall/address-list, not ip-address. Attribution: TBD.

### ipv6-address [20,37] — candidate `0x81047ca` (16 ops)

`{addr6:1, u32:2, u32:3, …}` vs schema `{bytes16:1, u32:2, u32:3}`:
✓✓ ids+types match (`addr6` = bytes_16). Extras (5/7-u32,
4/6/9-bool, 8-string). Attribution: TBD (8-ptr table).

Row builders live behind 8-ptr helper vtables (bridge2 T0–T3,
builder at [6]) and a 26-ptr table in net; reached via
`movl $VT` + virtual dispatch, not direct calls. T2/T3 are tiny
(`{u32:1, u32:2, u32arr:3}`, `{u32:1, u32arr:2, u32arr:3}`).

Store census (AMap/AHolder/StoreC1 → handler): bridge2 0x6/0xb/0xc/
0xd/0x14/0x1e/0x1f → meshports/msti/mst-override/vlans/portext/
portcntrl/extdev; net 0xa/0x39/0x3a/0x5c/0x2d/0x27/0x28/0x11/0x21 →
queuetypes/irq/rps/apn/layer7protos/ipt-calea/ebt-calea/**net/raw**/
?; net-0x11 = firewall RAW, not routerboard. Net also owns ~15 more
sections (devices, chains, nat, mangle, …) from factory contexts.

## 5. rbbios (61) — BIOS device proxy, not routerboard-info

Handlers: 1+2 = `AHolder("")`-derived (data-driven, slot 35 =
init+policies+device-read); 3 = custom (insmod
`drivers/char/csel0.ko` + `open(/dev/csel0)` in ctor; slot 10 =
setter touching `u32:1 + bool:3–8`). Sends `SYS_TO=[0x18,…],
SYS_CMD=5` requests (private cmd; target handler TBD). The
`{1:bool,2..5:string,6:u32}` insert cluster (`0x804daa2`) is DEAD
(5× verified: no callers/jmps/table/file refs).

`[24,17]` routerboard is STILL HOMELESS: absent from sys2, not in
rbbios/net-0x11/route-0x11 (firewall/raw/route tables). Next: scan
all binaries for a `{16:bool, 4:u32, strings…}` row-shape.

## 6. Tool notes (gotchas)

- `handlers.ts`: pair by the LAST `movl $VT,(%obj)` in
  (construct-anchor, call) — derived ctors overwrite base.
- Caller queries must allow objdump's trailing `<sym+off>` labels:
  `call\s+ADDR(\s*<.*>)?$` — bare-`$` misses everything.
- Field-id capture must EXCLUDE the `$` (`(\$0x…)` vs `(0x…)`).
- `message::ix<T>` renders as `messageixINS_` (no length prefix) —
  match `ix`, not `2ix`.

## 7. Open questions (static wall; WS-3C or client-side next)

- be32-vs-u32 byte order for ip-address (live/client proof).
- `0xfe0007`-vs-`0xfe000a` (dynamic-vs-disabled) + `0xfe000a` gap
  in the interface core.
- Exact roles: `0xfe0010/12/15/19/1b`, `0x10066/10030/10010`
  strings, bridge2-2/13 sub-request targets, slot 22/23 names.
- Sys2's other 15 handlers; quickset's 2 register-passed ids.
- Routerboard-info owner (row-shape scan, all binaries).

## 8. [20,0] GETALL fully decoded (post-WS-4 static re-visit, 2026-10-31)

Closes the WS-3C §13 `[20,0]` start-cursor thread and corrects the
WS-3C §11 "wrongly paired" note: the v6 vtable pairing was RIGHT
(`0x8113888`, slots 9–17 = base confirmed by PLT→GOT→dynsym
resolution of all 17 entries) — the error was assuming base dispatch.
There is NO slot-14 override. net-0 overrides **handleCmd at slot 7**
(slot 7 = `nv::Handler::handleCmd`, proven by sibling [20,1]'s vtable
`0x811e0e8` slot 7 = the handleCmd PLT stub `0x8051d30`), and GETALL
never reaches base slot 14 (NOTIMP).

### Dispatch (`0x80d1af8`, v6; `0x80682ec` @ vtable `0x81b2f18`, v7)

| cmd | path |
|---|---|
| `0xfe0004` GETALL, `0x10001` | async queue (obj+0x1a0) + worker `0x80d1040` |
| `0xfe0002` GETOBJ | SYNC: flags must == 5, by-id lookup, row core `0x80f6738`, reply; miss → UNKNOWNID |
| `0xfe0003/05/06` SETOBJ/ADDOBJ/REMOVEOBJ, `0xfe0016` RESET | queue + worker |
| [1000,1999] | per-interface method: by-id tree lookup keyed by `get(0xfe0001)`, virtual call slot 9 (`*0x24`) on the entry; miss → UNKNOWNID |
| everything else | BASE handleCmd (GET/SET → NOTIMP; small private integers → slot 19 `0x80d2f80`) |

v7 dispatch adds a cmd-`0xe` fast path (MAC-presence check via
`has(raw 0x404)`); else same shape (incl. the `0x10001` GETALL alias).

### Worker + iterator (v6 `0x80d1040` / `0x807763a`; v7 `0x8066774` / `0x8060306`, same shape, shifted offsets)

- Entries are dual-indexed: a **by-id tree** (obj+0x9c, key = entry+0
  = row-id) and an **iteration tree** (obj+0xac, begin obj+0xb0;
  nodes embed at entry+0x24). Bare GETALL walks the iteration tree
  from begin. The iteration ORDER is behavior-SOLVED (findings
  §19): stored order maintained by a dual-mode crossing-gated
  rename fixup (R1–R4, day-0-NIC-gated) — see "Iteration key:
  SUPERSEDED — dual-mode crossing-gated rename fixup". The §18
  head+tree model and the §17 creation-order label are both dead.
- **start = lower_bound(row-id)** in the by-id tree, INCLUSIVE, with
  NO validation: nonexistent ids continue from the next-higher id,
  beyond-max returns empty, absent (−1) starts at begin. Modeled,
  not opaque.
- **next-token = row-id of the next un-emitted entry** (`*(entry)`),
  emitted when count exhausts with rows left or bytes > 49999. Reply
  also carries `0xfe0004` = emitted-row count (v6; live-confirmed:
  `ev/6.49-getall-20-0.json` has `0xfe0004=1` for its 1 row).
- **count drift (single point)**: v6 `count = get(0xfe0004, 1000);
  if (count−1 > 999) count = 1000` → explicit count=0 means ALL
  (1000); v7 `count = get(0xfe0004, −1); if (count > 1000)
  count = 1000` → count=0 means ZERO rows (matches the live 7.25
  fixture reading). Defaults agree (1000); [1,1000] agree.
- **byte caps** (IDENTICAL both versions): soft 49999 (>49999
  with rows left → token + stop); hard 60000 (log `"getall resp
  too big, stopping at device ..."`, drop the row, stop); loop
  pre-checks 55000 + `(60000−bytes)/1000` emitted heuristic. v7
  proven at `0x806805a`/`0x8067f59`/`0x8068122` — see "v7 finish
  path decoded" below.
- **GETALL filters** (ALL legs live BOTH versions, findings
  §15–§16): criteria built by `0x805bc5c` (v7 `0x806316a`,
  identical) from `0x10001` (exact entry+0x60, default −1 = all),
  `0x10002`/mask-`0x10011` on entry+0x14 (mask defaults to val02),
  `0x10003`/mask-`0x10012` on entry+0x1c (mask defaults to
  val03|2); matched per entry by `0x805bc24` as an exact
  conjunction — see "Filter legs are row-field filters" below for
  the full decode. Bit 2 of entry+0x1c is skipped by the BARE
  default (`(w & 2) == 0` — hidden/deleted rows, NOT `0xfe000a`
  disabled, which stays visible); explicit masks override it.
  Slot-18 getcount honors the same filters. A request carrying
  nested `0xfe001b` reads start from the NESTED msg and iterates in
  ID order instead of stored order (same filter).
- Reply shape: `0xfe0002` row array + `0xfe0003` next-token (when
  truncated) + `0xfe0004` emitted count. No `0xfe001d`, no
  `0xfe0019` (both handler-specific absences, live-confirmed).

### s-matrix fit (findings §8) + version proof

The opaque s=0..8 matrix over 3 rows FITS lower_bound + creation
order given row ids {lo:1, ether1:2, bridge:5} and creation order
(ether1, lo, bridge): s=0,1 → lb=lo → [lo, bridge]; s=2 →
lb=ether1 → all three; s=3,4,5 → lb=bridge → [bridge]; s≥6 → end →
empty. Bridge id is NECESSARILY 5 (s=5→bridge-only, s=6→empty);
ids 3,4 are absent or hidden (bit-2-skipped, e.g. deleted vlan rows
— hidden ids ≥ 6 are also compatible). The matrix is
V7-only-consistent: v6 ether1 has id 1, which would make s=0,1
include ether1 (observed: excluded). The count=1→next=1→start=1
pagination proof is likewise [20,0]-shaped (2 rows ether1+lo:
head-1 = [ether1], token = lo's id 1, start=1 → [lo]).
CAVEAT (2026-10-31): the "creation order" label on the iteration
walk fit 2–3 rows but is REFUTED at 102 rows (findings §17) —
the 3-row fit constrains only the RELATIVE order
[ether1 < lo < bridge], which any surviving key model must keep.

Falsifiable predictions — ALL CONFIRMED live 2026-10-31 (see
findings §15): (1) v6 `[20,0]` count=0 returns ALL rows
(`ev/6.49-getall-20-0-count0.json`); (2) v7 `[20,0]` bare reply
carries neither `0xfe0004` nor `0xfe0019` (re-confirmed);
(3) `0x10001` GETALL filters select rows by entry+0x60 ==
row field (ether 1, loopback 76) on BOTH versions. Bonus live
quirk: v7 count=0 yields 0 rows + token = SECOND entry's id
(off-by-one follow skips the first row — consistent with the
v6 finish path advancing past the initial entry before the
count-exhausted check).

Truncation predictions — ALL CONFIRMED live 2026-10-31 on a
306-row table (findings §17, `ev/7.25-getall-20-0-bulk{2,3}.json`):
bare → 194 rows + token 203; start=203 → 112 rows ending at the
final row, no token; 306/306 unique, no gaps/dups,
order-continuous; no `0xfe0004`/`0xfe0019` either page (v7
token-only). ~260B/row ⇒ 102 rows fit, 306 don't.

### v7 finish path decoded (2026-10-31; closes the §8 open thread)

The v7 worker is a +0x48-shifted clone of v6 with ONE functional
delta. Reply builder `0x8067e3a` (v6 `0x80d1d36`), emit loop
`0x80680d0` (v6 `0x80d1fe0`), iterator `0x8060306` (v6 `0x807763a`):

| role | v6 field | v7 field |
|---|---|---|
| count remaining | obj+0x1b0 | obj+0x1f8 |
| in-flight counter | obj+0x1b4 | obj+0x1fc |
| iterator (current entry) | obj+0x1bc | obj+0x204 |
| byte counter | obj+0x1b8 | obj+0x200 |
| GETALL flags (0xfe000c) | obj+0x1d8 | obj+0x220 |
| filter criteria (5 words) | obj+0x1c0 | obj+0x208 |

Byte caps are IDENTICAL: soft 49999 (`0x806805a`, v6 `0x80d1f5a`),
hard 60000 with the same `"getall resp too big, stopping at "` log
(`0x8067f59`, v6 `0x80d1e50`), loop pre-checks 55000 +
`(60000−bytes)/1000` heuristic (`0x8068122/2a`, v6 `0x80d205a/62`).
The "v7 caps not decoded" caveat is retired — constants proven on
both versions; only live >50KB truncation behavior stays unobserved.

The single delta is the finalize block: v6 (`0x80d1f86–9c`) ALWAYS
inserts `0xfe0004` = emitted-row count (array bytes >> 3) before
`replyMessage`; v7 (`0x8068071–97`) inserts the `0xfe0003` next-token
when rows remain and goes STRAIGHT to `replyMessage` — no
`0xfe0004` echo exists on v7 [20,0]. This statically explains the
live token-only truncation (findings §15).

Count=0 quirk mechanics confirmed in BOTH: the emit loop exits
immediately (count already 0) into the reply builder with an empty
message, which takes the message-equal path, `decl`s the in-flight
counter to 0, ADVANCES the initial iterator past the first entry,
then hits the count-exhausted check with rows left → token = SECOND
entry's id, 0 rows emitted. Following the token skips row one.

### Filter legs are row-field filters (2026-10-31; closes static-only)

Matcher `0x805bc24` (v6; v7 same shape), args ecx=criteria,
edx=entry — exact conjunction:

```text
(entry+0x1c & mask12) == val03   AND
(entry+0x14 & mask11) == val02   AND
(val01 == -1 OR entry+0x60 == val01)
```

Builder `0x805bc5c` (v6; v7 `0x806316a` identical incl. defaults):

| criterion | request key | mask key | default mask |
|---|---|---|---|
| val03 / mask12 | `0x10003` (req, 0 when absent) | `0x10012` | **val03 \| 2** |
| val02 / mask11 | `0x10002` (req, 0 when absent) | `0x10011` | **val02** |
| val01 | `0x10001` | — (exact) | **−1 = all** |

CORRECTION to the §8 note above ("default mask = val|2"): the
`|2` applies ONLY to the 0x10012 mask. Bare GETALL therefore =
`(entry+0x1c & 2) == 0` (bit-2-hidden skip) + two match-alls.

The row-core (`0x80f6738`) maps entry offsets DIRECTLY to row
fields, so every filter leg is designable from observed rows:

| entry offset | row field | notes |
|---|---|---|
| +0x14 | `0x10002`/u32 | direct copy (`0x80f6891`) |
| +0x1c | `0x10003`/u32 | direct copy (`0x80f67f7`) |
| +0x60 | `0x10001`/u32 | type code (`0x80f6828`) |
| +0x1c bits | `0x1000e`/bool running | `(w & 0x500) == 0x500` (`0x80f6809`) |
| +0x14 bit 0x80 | `0xfe0007`/bool dynamic | presence-gated (`0x80f68fd`) |

Live values (both versions, stable across boots): ether1
`0x10002=270947 0x10003=542529`, v7 lo `0x10002=0
0x10003=525633` — all with bit 2 clear (visible) and
`(0x10003 & 0x500)==0x500` (running). The mask legs went live on
both versions in findings §16 (16 transcripts, all predictions
confirmed incl. both default-mask rules and the hidden-row select).

### Iteration key: SUPERSEDED — dual-mode crossing-gated rename fixup (2026-10-31)

The §18 "head + name-tree" model recorded here is DEAD
(findings §19 retraction; compacted "#1–#8/A/B/C"
details were unsaved confabulation — ground truth is
T1–T9 from iter1–6/2nic1–4). Behavior (~43 rename
transitions, all fit): R1 universal crossing-gate (swap
past adjacent N ⟺ N strictly between old and new, both
directions); R2 1NIC-mode (day-0 1-NIC: crossed-bubble
with a FROZEN pos0 slot — occupant immobile +
unenterable; leftward one-short, rightward full-run);
R3 2NIC+-mode (day-0 2/3-NIC: MOVE ⟺ crossed-run == 1,
single adjacent swap, no pos0-specialness); R4 mode ⟺
day-0 NIC count (fresh-box 4-way: twin4-F + ws19-day0-M
plus ws20-M + ws21-M). Creation = sorted-insert (incl.
pos0); reboot persists order and mode. 1NIC invariant:
sorted-except-possibly-(0,1). The §8 3-row order
[ether1, lo, bridge] still constrains relative order
under creation-insert. v6 iteration not yet probed (no
[20,0]-rename series on ws3c6); ws19 run≥3 untested.

The static +0x20-u32-key lead stays RETRACTED for this
tree (see below). NEW static entry point: the RENAME
fixup path in net (not the iterator) — it branches on
day-0-NIC-persistent state (tree birth-shape? lo depth?
phys-count field?) into a pos0-guarded bubble (1NIC)
vs a run-1-only single swap (2NIC+). Needs Ghidra/REA,
not objdump; v6 iterator `0x807763a` (+0x9c lower_bound
by id, `lea 0x24(%ecx)`, walk +0xac/begin +0xb0) is now
secondary to the rename path.

Prior retraction kept: the `lower_bound`-shaped helpers
at v6 `0x807edc4/0x807ee08/0x807ee4c` (comparing node−4
as u32) serve other +0xac trees in other objects
(generic template coincidence — dozens of callers
across 0x80a–0x810); the iteration comparator is
name-string. Live-proof beats the objdump reading.

Related anomaly RESOLVED (findings §18): the v7
0xfe0007=False bridge row is version drift in the
bridge-TYPE builder, not the row-core — a v6 bridge row
with the same f2=0x18223 omits 0xfe0007 (base rule holds
both versions; v7's bridge builder writes explicit False).

### v7 row-core decoded (2026-10-31)

v7 `[20,0]` row-core @`0x8064f1a` (8 callers incl. worker
`0x8067f0e`/`0x806823d`), same `ix<>` sequence as v6
`0x80f6738` with four deltas: (1) v6's 0x10066-STRING is
gone from base — v7 type builders write 0x10066 as U32
(`0x80659ae`, value from a walked sub-object; producer
moved base→type, type string→u32); (2) NEW 0xff001e
insert from entry+0x40 when ≠ 0xffffffff (`0x806515c`;
unseen live — absent from all captured rows); (3) shifted
offsets: 0x1000c/0x1003a from +0x180 (v6 +0x168),
0x1003c array from +0x1c8/+0x1a8 (v6 +0x1a4/+0x184);
(4) MAC tail differs (0x3e9 handling + type switch on
+0x60). IDENTICAL: 0x10002/0x10003/0x10001 direct copies
(+0x14/+0x1c/+0x60), running `(w&0x500)==0x500` (v7 uses
a NOT+TEST idiom, `0x8064fc4`), dynamic gate (`testb
$0x80,0x14(%ebx)` → present-True else absent,
`0x80650e6`). 0x10004 = entry+0x18→+0x28 (kernel ifindex,
proven live: lo=1, sequential, gap at a deleted interface,
absent on VRRP).

### Handler 134: third mark-registry instance (2026-10-31)

v7 net builds 13/14/134 from ONE factory (`0x8056724`,
malloc 0xec) with (max, name) = (0xfff/0xffff/0x7ffe,
"no-mark"), registered adjacently (`0x805c69e/0x805c6af/
0x805c6c3`; v7-only — v6 net has 13/14, no 134). Same
attach step for all three (string `0x8195337` =
"no-mark"). 11 live negatives (findings §17/§18):
mangle routing/packet/connection marks, IPv6 packet AND
connection marks (both share 13/14 — the prime 134
suspect refuted), bridge-filter marks (→13),
routing-table, route-in-table, routing-rule, VRF member,
queue-referenced marks. Same class, never populates —
driver unknown (MPLS/CAPsMAN/LTE out of CHR-lab scope).

### v7 Handler vtable shift (framework drift)

v7's `nv::Handler` vtable does NOT match the §1 (v6) slot map past
slot 12 — new `flat_message` overloads + `cmdStopGetAll` were
inserted (all PLT→GOT-resolved): 13=cmdGetObj-overload,
14=cmdSetObj(u32), 15=cmdSetObj-overload, 16=cmdGetAll,
17=cmdStopGetAll, 18=cmdAddObj, 19=cmdRemoveObj(u32),
20=cmdRemoveObj-overload. Slots 0–12 align (7 = dispatch, 9–12 =
get/set/reset/getobj). v7 [20,0] slot 24 = LOCAL private-cmd switch
`0x806885c` (cmds 2..15, reads start/count) — the v6 slot-19 role
moved. v7 libumsg dispatch (which slot DEFAULT routes to) NOT
decoded — open. "Slot 19 = cmdUnknown" is v6-only vocabulary from
here on.
