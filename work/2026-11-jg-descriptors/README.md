# .jg UI descriptors as an attribute source

<!-- cspell:ignore typevalue nonpublic getcmd roteros athhw igmp mrz webfig nextid sfd002a -->

Status: exploratory, 2026-11-21. Steps 1-3 promoted their stable
findings into `profiles/winbox-ipc/*.yaml`; the rest stays here. [`gui-handlers-vs-jg.md`](gui-handlers-vs-jg.md)
is generated output.

## Why

In the [OldBox thread](https://forum.mikrotik.com/t/oldbox-0-1-was-it-built-using-public-protocol-documentation/274612/6),
mrz (MikroTik) said the router sends its own UI schema over the session
(`roteros.jg` and one `.jg` per package). He said these files name menus,
windows, field ids, types and enums, and cover "most of what m2ir maps by
hand". m2ir had used them only once, for a static scan of the NAT, RAW,
Filter and Mangle dialogs (see `work/2026-10-chr-extraction/ws3c-prober-findings.md`).
The attribute plan's source strategy did not include them. This
directory tests his claim against `gui-handlers.yaml`.

## Reproduce

```sh
quickchr start twin3            # 7.25; also ws3c6 (6.49.23), winbox-beta4 (7.26beta4)
bun work/2026-11-jg-descriptors/jg-fetch.ts http://127.0.0.1:9120 <scratch>/jg/7.25
bun work/2026-11-jg-descriptors/jg-parse.ts <scratch>/jg/7.25 "[20, 0]"
bun work/2026-11-jg-descriptors/jg-diff.ts profiles/winbox-ipc/gui-handlers.yaml \
  <scratch>/jg work/2026-11-jg-descriptors/gui-handlers-vs-jg.md
```

`jg-diff.ts` expects one subdirectory per version (`6.49.23`, `7.25`,
`7.26beta4`). The `.jg` files belong to MikroTik. Keep them in scratch and
never commit them. Only the derived report is committed.

## Format

- Transport: WebFig reads `/webfig/list`, which needs no login. It then
  fetches `/webfig/<unique>`, for example `roteros-57fef61b6e4007d5.jg`.
  WinBox receives the same files over its session.
- Syntax: JavaScript object literals with unquoted and numeric keys and
  single-quoted strings. These are not JSON or JSON5. `jg-literal.ts`
  parses them without `eval`.
- Route: a node with `path:[sys, handler]` and a `type` (`item`, `map`,
  `action`, `statusbar`, ...) is a dialog bound to that M2 route.
  `values:{type:'dynamic',path:[...]}` is an enum filled from another
  route's rows, not a dialog.
- Field id: one type letter plus a hex key. For example, `u10006` is a u32
  in namespace 0x01, field 6, and `bfe0008` is a bool, 0xfe0008.
  Type letters seen: `u` u32, `q` u64, `s` string, `b` bool, `r` raw
  bytes/MAC, `a` IPv6, `m`/`M` message/message array, `U`/`S`/`Q`/`R`/`A`/`B`
  arrays.
- **The type is part of the identity.** `u10` (Region Revision) and `s10`
  (Region Name) are two attributes on the same bridge row. This explains
  the "f16 carried TWICE (u32 and string)" observation in `gui-handlers.yaml`.
- Templates: `{path:[20,0], generic:'iface'}` defines a template.
  Sub-dialogs have `inherit:'iface'` and `typevalue:N`, where N is the
  interface type-code in `[20,0]` ns1 f1 (for example, bridge is 12 and
  VLAN is 30). The same pattern exists for `ppp`, `file`, `file2` and
  `route`. Namespace-0 ids on a template route collide across
  sub-dialogs, so the diff restricts `[20,0]` ns0 to the Bridge dialog,
  which is where the YAML rows were observed.
- Gating: `pred:{type:'board',value:'CHR'}` and similar predicates select
  between dialogs on the same route. For example, `[65]` has a CHR and a
  non-CHR License dialog, and they use field 12 differently.
  `nonpublic:1` marks hidden helper fields. They still carry the wire id.
- Not in the files: layout rules and client behavior. This matches mrz's
  "how WinBox reads each attribute is not sent over the network".

## Result (2026-11-21)

`.jg` lists 465, 498 and 667 routes on 6.49.23, 7.25 and 7.26beta4. That
is about 7.1k, 9.3k and 11.8k field ids. These totals mix version and
package set: the router serves one `.jg` per installed package, the 7.25
CHR (twin3) had no extra packages, and the 7.26beta4 CHR (winbox-beta4)
was built with `--install-all-packages`. Counting only the nine files
both serve (`roteros`, `ipv6`, `wave2`, `dhcp`, `ppp`, `hotspot`,
`secure`, `advtool`, `ups`), 7.26beta4 has the same 498 routes as 7.25
and 99 more field ids (9,434). The other 169 routes come from ten package
files: `dude` 42, `wlan6` 36, `iot` 30, `cmr` 22, `container` 14,
`userman5` 14, `oflow` 5, `netinstaller` 4, `gps` 1, `tr069` 1 (counted
2026-11-21, see plan step 4c). `gui-handlers.yaml` models 356
typed fields on 34 routes. Counts are from the typed diff: a YAML field
matches only `.jg` ids with the same type letter.

| class | count | meaning |
|---|---|---|
| unknown-named | 120 | YAML `unknown-*`, `.jg` gives a name |
| agree | 83 | names match |
| name-differs | 22 | mostly synonyms; real conflicts below |
| type-differs | 1 | `.jg` has the number only under another type (routerboard f1) |
| jg-unnamed | 17 | `.jg` uses the id only inside an unnamed sub-control |
| yaml-only | 113 | seen on the wire but in no `.jg` dialog |

After step 1 of [`plan.md`](plan.md) (promotion, 2026-11-21) the same
diff reads: unknown-named 0, agree 201, name-differs 25 (intentional:
CLI names kept, `.jg` text in `label:`), jg-unnamed 17, yaml-only 113,
type-differs 0. The 51 `unknown-*` fields left in the YAML appear in no
`.jg` dialog and need probes.

`.jg` also has 470 routes on 7.25 with no YAML handler, plus 1,199 field
ids on the 34 modeled routes that the YAML does not list. mrz's claim
holds for naming and enums. It does not cover wire-only fields, version
behavior, write semantics or notification behavior, which still need
probes.

### Validated against live values

The bridge row unknowns in `interface` ns0 match by name and by observed
value. Examples: f4 300 = Ageing Time, f5 15 = Forward Delay, f8 20 = Max
Message Age, f19 20 = Max Hops, f100 2 = Protocol Mode, f107 1 = PVID,
f110 33024 = EtherType 0x8100, and f117–f121 = IGMP intervals in 1/100 s.
Every YAML enum that `.jg` also lists agrees on every value. `.jg` adds
values we never observed: filter `protocol` gets 30 more, and NAT `action`
gets `1=jump`, `26=endpoint-independent-nat` and `27=socksify`. The NAT
`action` note says "no public source names the numeric association", which
is no longer true.

### Notable names for existing unknowns

- `interface` ns1: f12, f47 and f58 are Queue Type, Default Queue Type and
  Active Queue Type, all enums over `[20,10]`. That explains the shared
  -4 value. f56 is Last Link Up Time, which explains "boot-fixed, not
  uptime". f57 is Link Downs, f49 is Default Name, f102 is the VRF enum
  over `[20,101]`, and f2 is caps.
- `bridge-port [16,2]`: every unknown f1–f39 is named, with enums. For
  example, f10 Edge is `0 auto, 1 yes, 2 no, 3 yes discover, 4 no discover`.
- `bridge-host [16,3]`, `ipv6-address [20,37]`, `[20,120]`/`[20,121]` (Tx
  Manager/Queue), `[13,2]` and `[13,4]` have their unknowns named. `[13,4]`
  f4 Via is a 13-value enum that includes `romon` and `tikapp`.

### Conflicts to resolve before promotion

- `routerboard [24,17]` is already marked ATTRIBUTION SUSPECT. `.jg`
  confirms f7, f9, f10, f13, f15, f16 and f24 as RouterBOARD fields. f1
  and f4 are Baud Rate and Enter Setup On in the non-x86 Settings dialog.
  The YAML names for f1 and f4 (`software-id`, `nlevel`) match the non-CHR
  License dialog on `[65]` (`s1`, `u4`), so the private source probably
  merged the two handlers.
- `license [65]` f12 `nlevel` is supported by the CHR dialog: `uc` is a
  Level enum with 0 free, 1 P1, 2 P10 and 3 P-unlimited. The non-CHR
  dialog uses `sc` (Serial Number) for the same number.
- `boot-flags [24,10]` f1 `disable-smp-flag` is "Multi CPU" on x86 in
  6.49.23, and absent in 7.x. Check whether the polarity is inverted.
- `policy-catalog [13,3]`: f1 and f2 are Name and Alias in `.jg`, but
  `description` and `policy-name` in the YAML. Compare them with a live row.

## Dialog conversation census (plan step 2)

[`conversation-census.md`](conversation-census.md) is generated by
`jg-commands.ts`. It counts the conversation attributes each dialog
declares and classifies every declared command against
`profiles/winbox-ipc/std-commands.yaml`.

- Dialog types on 7.25: 430 `map` (lists), 105 `item` (single objects),
  32 `action` (start/poll/cancel jobs), 59 `doit` (one-shot buttons),
  29 `query`, and a few others.
- Every declared standard command is in `std-commands.yaml`. The ones in
  use are CMD_START/POLL/CANCEL for actions, CMD_GETALL, CMD_ADDOBJ and
  CMD_RESET. `0xffffffff` means the dialog disables that step (for
  example, an action with no cancel).
- Most declared commands are handler-local opcodes, and `.jg` names them.
  On `[20,0]`: 2 Blink, 10 Reset Traffic Counters, 14 Reset MAC Address,
  1001 Reset Counters, 1005 Power Cycle, 1006 Cable Test (start, poll and
  cancel), 1007 Join. `commands.yaml` lists such small private opcodes
  without names; this is the cross-check for them.
- 96 of 430 list dialogs on 7.25 declare `autorefresh` (1000 ms is the
  most common). `refreshfilter` is a bit field, not a flag.

## WebFig client model (7.x `master.js`, tested in step 3)

First read statically from 7.25 `master.js` (`source: code`), then
recorded live on 7.25 and 7.26beta4 (plan step 3, [`webfig/`](webfig/README.md)).
Seq numbers refer to
[`7.25-webfig-bridge-workflow.jsonl`](../../fixtures/winbox-ipc/7.25-webfig-bridge-workflow.jsonl).
The 7.26beta4 fixture has the same events at its own seq numbers.

| Operation | Static prediction | On the wire (7.25, 7.26beta4) |
|---|---|---|
| list | GETALL `getallcmd \|\| 0xfe0004`, `0xfe000c = 0x10000005 \| refetchonopen \| refreshfilter`, `0xfe0018 = maxobjs` | **Confirmed.** Bridge (`[20,0]`, which inherits the iface map: `refreshfilter:262154`) sends `0x1004000f` (seq 98). Bridge Ports (`refreshfilter:2`) sends `0x10000007` (seq 175). `0xfe0018` is absent because neither dialog declares `maxobjs`. The `typevalue=12` filter is applied in the client: the GETALL returns all four interfaces (seq 103) |
| paging | follow `0xfe0003` / `mfe0015` | **Confirmed** for `0xfe0003`: `[24,7]` returns 586 rows plus `ufe0003=586`, and WebFig repeats the GETALL with `ufe0003=586` (seq 261). `mfe0015` was not seen |
| list updates | CMD_SUBSCRIBE `0xfe0012` on the path, always | **Confirmed**, once per path per session (seq 97, 174). Updates arrive as `CMD_NOTIFY 0xfe000b` messages with `TO=[]` in the reply to WebFig's long poll, a POST carrying only `Sff001c`. A REST change showed up about 0.2 s later (seq 124 → 155, seq 204 → 238) |
| notification rows | `_id`, `ufe0005` next id, `ufe0013` removed, `ufe0019` count; no rows → GETALL | **Confirmed.** Rows carry the config fields only: 85 of 126 keys for the bridge and 38 of 66 for the port. The status and counter groups that GETALL returns are missing. Whether the `refreshfilter` bits select those groups is untested (step 4). Ordered maps (`[16,2]`) carry `ufe0005` (0xffffffff = last) and message-level `ufe0019`. Removal sends a row with only `ufe0001` + `ufe0013=1` (seq 613, 614). An empty `Mfe0002` was not seen |
| autorefresh | timed GETALL on top of notifications | **Confirmed.** GETALL every 1006 ms on Bridge (iface `autorefresh:1000`) and every 2005 ms on Bridge Ports (median). Timers stop when the tab is left |
| list close | CMD_UNSUBSCRIBE `0xfe0013` | **Refuted for tab navigation.** No `0xfe0013` in any run. Reopening sends no new SUBSCRIBE, and the router keeps notifying for pages that are closed (seq 444 → 448, 451). `unsubscribe()` posts only when the last listener for the path goes away |
| object | GET `getcmd \|\| 0xfe000d`, same `0xfe000c` word | Seen for `[24,0]` (Clock, `0x10000005`, timed every 1 s). The ether1 dialog (`#Interfaces.Ethernet.2`) made no per-row GET: it reuses the `[20,0]` list |
| long poll | `post_notification_request()` | **Confirmed.** Each poll stays open until a notification is queued (3 to 20 s in the runs); a quiet poll was still open after 51 s (seq 615). Every poll that returned carried frames |
| keepalive | not in table | `CMD_NOOP 0xfe0000` to `[1]` every 20 s (`setInterval`, seq 198) |
| errors | `0xfe0004` on GETALL: clear and refetch; `0xfe000e`: "Failed to get all" | Not exercised. The only errors were `[17]` "nothing to undo/redo" (`0xfe0006`) |

Other findings from the same runs:

- **`[17]` undo history.** After every change WebFig fetches the
  undo/redo heads with `0x80007` / `0x80008`. `[17]` notifications carry
  each history entry with the CLI text (`S9`), its inverse (`Sa`), the
  source (`s8 "api:admin@::"`), and the **native M2 request plus its
  inverse** (`m1`, `m2`). The REST `add bridge` is recorded as `[20,0]`
  `0xfe0005` with `u10001=12`, `s10006` name and `sfe0009` comment
  (seq 53). This is a ready REST/CLI → M2 mapping (lead).
- **Session id.** Replies address `TO=[n]`, where `n` is the WebFig
  session's own handler id (3 to 8 across runs).
- `Sff001c` is a client-tag string array (`"x11-linux-x86-64"`). WebFig
  appends to it on each send, so a paging request that reuses the
  previous request object carries the tag twice.
- **No `Q` or `R` keys, no `mfe0026`.** ether1 on a CHR has no
  `extrastats`, which gates the `Q480` Tx Packets tab, so the 0x90 lead
  needs hardware. Key 0x478 is a typed-identity case: `.jg` declares it
  as `U478` in one dialog and `Q478` in another, and CHR ether1 sends
  `U478` (tcode 0x88, empty) in its `[20,0]` row (seq 103).

## Native replay (plan step 4)

[`native-replay.ts`](native-replay.ts) replays the step 3 Bridge workflow
over the native WinBox transport with three SRP sessions: A subscribes
and reads, B is the other client (SETOBJ, ADDOBJ, MOVEOBJ, REMOVEOBJ), and
C probes subscription bookkeeping. centrs (REST on v7, the native API on
6.49) only creates the lab objects (bridge `m2ir-br`, VLANs `m2ir-vl1..3`
on ether1, two ports) and removes them. Every message goes through a
`MessagePump` (`../2026-11-winbox-attributes/harness/pump.ts`): one reader
loop that captures each frame on arrival, matches replies by SYS_REQID
and keeps unsolicited frames for timed listen windows.

```sh
quickchr start twin3          # also winbox-beta4 (7.26beta4), ws3c6 (6.49.23)
bun native-replay.ts --quickchr twin3 --out <scratch>/n725 --allow-mutations --disposable
bun native-report.ts <scratch>/n725 ../../fixtures/winbox-ipc/7.25-webfig-bridge-workflow.jsonl
bun native-fixture.ts <scratch>/n725 ../../fixtures/winbox-ipc/7.25-native-bridge-workflow.json \
  --iface-words absent,0x5,0x2,0x8,0x40000
quickchr stop twin3
```

The fixtures are
[`6.49`](../../fixtures/winbox-ipc/6.49-native-bridge-workflow.json),
[`7.25`](../../fixtures/winbox-ipc/7.25-native-bridge-workflow.json) and
[`7.26beta4`](../../fixtures/winbox-ipc/7.26beta4-native-bridge-workflow.json)
`-native-bridge-workflow.json`. Records carry `mark` (the driver step,
cited below), `session` and `tMs`. Messages over 256 bytes keep their hex
with `entries: null`. [`native-bridge-workflow.test.ts`](../../test/profiles/winbox-ipc/native-bridge-workflow.test.ts)
decodes every record with the independent replay parser and checks the
results below, including the key-for-key match with the WebFig fixtures.

| Question | 7.25 and 7.26beta4 | 6.49.23 |
|---|---|---|
| q1: unsolicited traffic after SUBSCRIBE | CMD_NOTIFY `0xfe000b` about 200 ms after B's ack, FROM=path, no SYS_REQID, **TO=[0,11]** (the session's own address, not WebFig's TO=[]). Rows equal WebFig's key for key: bridge 85 (87 on beta4), port 38 (`q1-*`). The session that made the change is notified too (`q1-self-change`) | Same shape; rows 58/30 keys. The originating connection is **not** notified, and rows carry SYS_ORIGINATOR `Uff0012=[2,conn,0,11]` |
| q2: does `0xfe000c` select content? | **Yes, bit `0x2`.** No word, 0, 5, 0x10000005, 0x8 and 0x40000 return config-only rows (= the notification shape). 0x2, 0x4000a, 0x1004000f and 0x10000007 add the status group: bridge 126 (132), port 66 (67), equal to WebFig's GETALL rows (`q2-words`) | Same split (bridge 58 → 97, port 30 → 40) |
| q2b: word on SUBSCRIBE | Selects the groups in notification rows, for **every** subscriber of the path on the router while that subscription lives (`q3c-5` .. `q3c-11`) | Ignored for content; rows stay config-only |
| q3: UNSUBSCRIBE `0xfe0013` | Stops notifications for that path (`q3-unsub-*`). A subscription is keyed by (session, path, word): plain SUBSCRIBE is idempotent, plain + worded give two copies, UNSUBSCRIBE removes only the matching word, repeats are acked no-ops, closing the session drops all (`q3c-1` .. `q3c-12`) | Same bookkeeping. Closing session C also sent A a CMD_DISCONNECTED `0xfe0014` pair (FROM `[0xff0003,774]` and `[2,774]`, TO=[]) |
| q4: ordering | `[16,2]` GETALL rows chain by `0xfe0005` in list order, last = 0xFFFFFFFF. ADDOBJ notifies only the new row (next 0xFFFFFFFF); the old tail is not re-sent. MOVE `{0xfe0001, 0xfe0005=before-id}` reorders (0,1,2 → 2,0,1, REST `.nextid` agrees) and notifies only the moved row. `0xfe0005=0xFFFFFFFF` (WebFig's "to end") and rowid-only MOVE are acked no-ops | Chain and ADDOBJ the same; MOVE with a before-id is acked but **does not reorder** |
| q4: removal | Row `{0xfe0001, 0xfe0013=1}`, where `0xfe0013` is a **u32** (tcode 0x09), not a bool; `[16,2]` adds the new `0xfe0019`. Removing the bridge leaves its ports (re-notified, REST `inactive`) | Same |

What `.jg` declares: the Ports dialog lists the status fields as f200
and up (`ud0` Port Status, `uc8` Role, `bcd` Forwarding, ...). Every key
that bit `0x2` adds has a field id >= 0xc8 on both routes and all three
versions, and on `[16,2]` the split is exact. `.jg` does not mark the
group; the dialog's `refreshfilter` asks for it, and its other bits (0x8,
0x40000 on iface) changed nothing on a CHR.

Step 3 statements, rechecked natively:

- Confirmed: SUBSCRIBE then GETALL; notifications as CMD_NOTIFY about
  0.2 s after the change; config-only notification rows (85/126 bridge,
  38/66 port); `ufe0005` on ordered maps; removal rows; `ufe0019` on
  `[16,2]`; 7.25 and 7.26beta4 alike.
- Refined: TO=[] is the /jsproxy form; natively TO is the subscriber's
  address. "Notification rows lack the status groups" holds only while no
  subscription on the path carries bit 0x2 (7.x).
- Answered (was untested): the refreshfilter bit 0x2 selects the status
  group; 0x8 and 0x40000 do nothing on a CHR.
- Refuted in the schema: `0xfe0013` is u32, not bool.
- Still untested: an empty `Mfe0002` refetch, `mfe0015` paging, GETALL
  errors, Q/R keys (hardware), and what WinBox 4 itself sends (step 5).

### `[17]` undo history as a REST/CLI → M2 oracle (time-boxed probe)

Superseded by plan step 4b below, which replaced the probe script and
corrected one claim (a SET inverse carries the whole record only for
some handlers). The probe text is kept as it was.

The probe subscribed to `[17]` natively and made
four REST changes on menus that `gui-handlers.yaml` has no handler for,
then restores them (7.25, 30-minute box). The SUBSCRIBE alone replays the
whole history (131 rows, including this session's native harness writes,
source `tcp-msg(winbox)`). Each row names the native request (`m1`) and
its inverse (`m2`):

| CLI (`S9`) | `m1` route, command | Typed keys in `m1` |
|---|---|---|
| `/ip dns set cache-size=4096KiB` | `[14,2]` CMD_SET `0xfe000e` | `u4` = 4096 |
| `/snmp set contact=... location=...` | `[34]` CMD_SET | `s2` contact, `s3` location |
| `/ip firewall address-list add address=192.0.2.1 comment=... list=m2ir` | `[20,35]` ADDOBJ `0xfe0005` | `u3` = `u4` = 192.0.2.1 (u32 LE), `sfe0010` list, `sfe0009` comment |
| `/ip firewall address-list set *2 comment=...` | `[20,35]` SETOBJ `0xfe0003` | `ufe0001`, `sfe0009`, plus `sfd002a` = "" |
| `/ip firewall address-list remove *2` | `[20,35]` REMOVEOBJ `0xfe0006` | `ufe0001` |

For a SET or a remove, the inverse carries the **whole prior record**:
`Sa` lists every CLI property with its value and `m2` every typed key
with the same values. For `/snmp set`, `trap-community=public` sits next
to `s4 "public"`, and `engine-id-suffix` and `vrf` sit next to their keys,
so CLI names map to typed keys by value. Verdict: worth its own plan
step. It names route, command and typed keys for any configurable menu
with one write each on a disposable CHR, and no field guessing. Limits:
config only (no status or counters), values must be distinct to match
names, and IP/array encodings need care. Nothing is promoted from it yet.

## `[17]` undo-history oracle (plan step 4b)

<!-- cspell:ignore centiseconds sfd002a icmp mangle netwatch -->

Status: questions 1-5 answered on 7.25 and question 6 on 7.26beta4
(2026-11-21); 6.49 not checked (v7 first, see plan.md). Profile entry:
[`undo.yaml`](../../profiles/winbox-ipc/undo.yaml). Fixtures:
[`7.25`](../../fixtures/winbox-ipc/7.25-undo-oracle.json) and
[`7.26beta4`](../../fixtures/winbox-ipc/7.26beta4-undo-oracle.json)
`-undo-oracle.json`, both replayed by [`undo-oracle.test.ts`](../../test/profiles/winbox-ipc/undo-oracle.test.ts).
Generated mappings: [`undo-oracle-mapping-7.25.md`](undo-oracle-mapping-7.25.md)
and [`undo-oracle-mapping-7.26beta4.md`](undo-oracle-mapping-7.26beta4.md).

```sh
quickchr start twin3
DI=~/Projects/tikoci/restraml/docs/7.25/deep-inspect.json
bun undo-q1.ts --quickchr twin3 --out <scratch>/q1 --allow-mutations --disposable
bun undo-menus.ts survey --deep-inspect $DI --quickchr twin3 --out <scratch>/survey.json
bun undo-oracle.ts --quickchr twin3 --out <scratch>/w1 --deep-inspect $DI --allow-mutations --disposable
bun undo-report.ts <scratch>/w1 --jg <scratch>/jg/7.25 --deep-inspect $DI --out undo-oracle-mapping-7.25.md
bun undo-fixture.ts ../../fixtures/winbox-ipc/7.25-undo-oracle.json <scratch>/w1 <scratch>/q1
quickchr stop twin3
# question 6: the same on winbox-beta4 with docs/7.26beta4/deep-inspect.json
# and the 7.26beta4 .jg (q1 with --cap-writes 150)
```

[`undo-lib.ts`](undo-lib.ts) holds the `[17]` listener (a `MessagePump`
that subscribes and turns CMD_NOTIFY into history rows) and the centrs
call. [`undo-menus.ts`](undo-menus.ts) holds the CLI tree reader, the
safety rules and the wave-1 menu list.

### Method

For every settable property of a menu, centrs sets it over REST to the
value REST prints for it (a no-op SET). Each such write records one
history row, and that row's `m1` holds exactly the typed keys the router
wrote for that one property. So the mapping comes from isolation, not
from matching values. The value is then checked against the CLI text in
`S9` for confirmation. Tables without rows get a disabled row with
documentation addresses (add, no-op SETs, remove); the remove's inverse
carries the full record. The configuration ends as it started.

### q1: reversibility and noise

| Behaviour | 7.25 |
|---|---|
| SET to the current value | Records a row. `S9` names the property, `m1` holds its keys, `Sa` is empty. `m2` is empty or holds a read-only counter that moved (DNS cache-used `u5`). `/snmp` is the exception: its inverse is always the whole record |
| SET that changes a value | `Sa`/`m2` hold the fields that changed (address-list comment: `ufe0001` + `sfe0009`), not the whole record. The step-4 probe overstated this |
| Remove | `Sa` is an add with every property, `m2` an ADDOBJ with every typed key |
| Undo / redo | Native `0x80001` / `0x80002` and REST `/undo` / `/redo` both restore cleanly (REST read-back after each). No new row: the same row is re-notified with `u4` = 1 (undone) or 0, `s8` suffixed `/undo` or `/redo`, `S9`/`Sa` swapped. The undo reply comes FROM `[17, 20, 35]`, the owner route |
| Peek | `0x80007` / `0x80008` return the row undo or redo would act on; empty redo = error `0xfe0006` "nothing to redo" |
| A change after an undo | Drops the undone rows: removal row `{ufe0001, ufe0013 = 1}` |
| Cap | 100 rows (1200 native SETs: GETALL total 100, REST history count 100). Each new row past the cap notifies a removal row for the oldest |
| Replay | SUBSCRIBE replays the whole history only when no other session subscribes to `[17]`; a second concurrent subscriber gets nothing. GETALL pages it (20 rows a page, newest first, token `ufe0003`, total `ufe0019`) |
| Reboot | After a CHR stop/start the history held only the one change made since (131 rows before) |
| Noise | Every no-op row takes an undo step. A no-op SET re-applies the value; side effects were not checked beyond the REST and native sessions staying up for the whole run |

Safest write per menu kind: singleton → no-op SET per property; table
with rows → no-op SET per property on one row; empty table → add a
disabled row with documentation addresses, no-op SET per property,
remove. Comment SETs are not needed. Three no-op SETs recorded no row
(`/queue/type pfifo-limit`, `/system/logging/action memory-lines` and
`memory-stop-on-full`).

### q2: secrets

Rules in [`undo-menus.ts`](undo-menus.ts), applied before any write:

- `SECRET_ARG` matches credential-valued properties (password,
  passphrase, secret(s), psk, token, community, `*-key`, `ipsec-secret`,
  `radius-password`, `trap-community`, ...). The oracle never writes
  them. 55 of the 319 menus have at least one. A menu with one is never
  run as `add`, since its remove inverse would carry the full record.
- `SKIP_MENUS` (38 menus): a remove inverse or a full-record SET inverse
  would carry a credential (`/user`, `/ppp/secret`, `/snmp/community`,
  `/radius`, WireGuard, IPsec identity/peer, hotspot and SMB users,
  wifi security, certificates, e-mail, RoMON, SMS, local-update mirror),
  or a write has effects even when the value is unchanged (`/ip/service`
  and its webserver, `/ip/ssh`, `/system/clock`, watchdog, package
  update, `/ip/cloud`, MAC server and MAC WinBox, console settings).
  `/system/identity` is already modeled and its value is the machine
  name.
- `SKIP_ARGS`: row identity and clock (`name`, `numbers`, `time`, `date`,
  ...).

Redaction ([`undo-fixture.ts`](undo-fixture.ts), applied to the decoded
message, then re-encoded; decode → encode is byte-exact on all 2542
captured messages): source strings (`s8`, `m1`/`m2` `Sff001c`) become
`<proto>:<user>@<lab><rest>`. `SECRET_ARG` values in `S9`/`Sa` become
`<redacted>`, and so does any string in the row equal to one of them.
Row `u7` and address-list `ua` (wall-clock) become 0. The builder
refuses to write a non-documentation IPv4 address or a secret, and the
test scans the decoded strings again. `/snmp` is mapped in the report
but left out of the fixture: its full record carries the community name
and the engine id.

### q3: menu selection

restraml's 7.25 `deep-inspect.json` has 319 menus with a `set` command:
65 singletons and 254 tables (`undo-menus.ts survey` reads each once
over REST). Wave 1 takes 34: 20 singletons, 5 tables with a default row,
9 empty tables with an added row. They reach **30 routes**, of which
2 were modeled before this step (`[20,17]`, `[24,33]`, run as controls).
Five CLI menus share `[20,17]`: `/ip settings`, `/ipv6 settings`,
`/ip firewall connection tracking`, `/ip neighbor discovery-settings`
and `/interface bridge settings`.

### q4: name by isolation, then by value

257 CLI properties: 244 map to one typed key, 13 to several (an IPv4
address writes `u3` and `u4`; `discover-interface-list` writes a `not`
flag `b34` and a list reference `u35`; rate and time pairs write one key
per half). Of 270 keys, 210 equal an encoding of the CLI value, 59 are
explained (enum values, references, keywords such as `disabled` =
0xFFFFFFFF, nested messages) and 1 is unexplained (`/queue simple target`
also writes `b75` = true). Encodings that need care:

| CLI form | Wire | Example |
|---|---|---|
| IPv4 | u32 little-endian | 192.0.2.1 → 16908480 |
| IPv4 range | `[start, end]` u32 array | `/ip pool ranges` → `Ub` |
| IPv4 prefix | message list `{address, netmask}` | `/queue simple target` → `M72` |
| IPv6 | 16 bytes; prefix length on its own key | `/ipv6 firewall address-list` → `a6` + `u7` |
| Interval | seconds, milliseconds or **centiseconds**, per field | DNS cache-max-ttl 1w = 604800; query-server-timeout 2s = 2000; conntrack tcp-established-timeout 1d = 8640000 |
| Size | KiB as shown, or bytes | cache-size=2048KiB → 2048; ipv4-high-fragment-thresh 4096.0KiB → 4194304 |
| Decimal | x1000 | bucket-size 0.1 → 100 |
| Enum | number | `mode=tx-and-rx` → 0; `trap-version=1` → 0 |
| Enum set | bit mask | `protocol=cdp,lldp,mndp` → 7 |
| Reference | object id | `vrf=main` → 0; interface list `static` → 33554435 |
| Keyword | 0xFFFFFFFF | `lldp-med-net-policy-vlan=disabled`, `interfaces=all` |
| Date | Unix time at UTC midnight | scheduler start-date |

`.jg` field types often say which interval unit to expect (`interval` =
seconds, `fixedpoint` = milliseconds). Name-by-value matching on full
records alone is weaker: address-list has 0 unique matches (list and
comment were both `m2ir`; `u3` = `u4`), and on `/snmp` it pairs
`trap-community` with `s4` (the community name) while the `.jg` declares
the property as `u11`, a reference to the community row. The report lists
these per menu.

### q5: cross-check with `.jg`

For each isolated key, the same typed key on the same route in the 7.25
`.jg`: **243 agree, 0 type-letter conflicts**, 21 are standard `0xfe`
keys (comment, disabled, dynamic, name: `.jg` draws them with its own
controls), 6 are oracle-only (`/ip settings icmp-rate-mask` `u1c`,
`/tool sniffer` `Md5`/`u1e`, address-list `u4`, IPv6 address-list `u7`,
queue `b75`). `.jg` labels agree with the CLI name for 233 keys, differ
for 4, and 6 `.jg` controls are unnamed. `.jg` declares 519 writable and
128 read-only fields on these routes that no write touched: REST prints
only the properties that are set, so properties left at their default
were not written.

### q6: version drift (7.26beta4)

The same q1 probe and wave-1 run on winbox-beta4 (7.26beta4, all
packages installed): 34 menus, the same write counts, no REST failures.

- **Mapping:** all 257 properties give the same route, command, typed
  keys and encoding. Values are equal for 256; `/system/scheduler
  start-time` (`u12e`, seconds on both) holds the clock time of the add,
  so only the sampled value differs.
- **`.jg` cross-check:** the same counts. On these routes the 7.26beta4
  `.jg` adds only `b401`/`b402` on `[97,1]` (Traffic Flow "NAT Src./Dst.
  IPv6 Address"), which no wave-1 write reached.
- **History behaviour:** the same (no-op rows, undo/redo re-notify, cap
  100, replay only to the first subscriber, GETALL paging).
- **Drift:** REST changes are now sourced `rest:admin@<address>` in `s8`
  and `m1` `Sff001c`; 7.25 says `api:admin@<address>`.
- 6.49.23 was not checked: v7 first (plan.md); `[17]` on 6.49 stays an
  open question in `undo.yaml`.

### Promotion rule

An oracle mapping enters `gui-handlers.yaml` when all of these hold:

1. A no-op SET (or an add) of one CLI property records a history row whose
   `m1` names the route, the command and the property's typed keys, in a
   committed fixture or generated report (`source: sample`).
2. The key's type letter agrees with the wire tcode, and the value is
   confirmed by an encoding of the CLI text or explained (enum value,
   reference, keyword). Unexplained values stay out.
3. The `.jg` of the same version declares the same typed key on the same
   route (`source: doc`). The field takes the CLI name, `cli-alias`, and
   `label:` when the `.jg` label differs. A `.jg` miss or a name conflict
   keeps the field in the report as a proposal.
4. Version scope is the version of the run (`set.versions`); another
   version needs its own run (7.26beta4 added after question 6).
5. Handler entries stay `confidence: observed-only`. The read command
   comes from the `.jg` dialog type (item = GET, map = GETALL) until a
   native read is captured; the entry says so.

Never promoted: values of `SECRET_ARG` properties, keys known only from
a full record (not isolated), and value-only matches.

Promoted (7.25): `[20,17]` (role corrected to the shared net-settings
singleton; 13 discovery-settings fields; f79 `suffix-or-mode` →
`add-dns-entries-suffix`), `[14,2]` dns-settings (17 fields), `[34]`
snmp-settings (9 fields), `[20,35]` address-list (7 fields, `u4` kept as
unknown-4). Proposed in the report: the other 26 routes, including the
other four `[20,17]` groups.

Limits: config only (status fields and counters are not written); only
properties REST prints (set, non-default) are reached; one value per
property, so enums get one value each; `[find]`-selected SETs add
`sfd002a` = "" (not with `numbers=*N`).

## Next steps

1. Promote the named unknowns and enum values into `gui-handlers.yaml`
   with an evidence entry for each version's `.jg`. Keep the observed
   values, and leave wire-only fields as they are.
2. Use `.jg` as the candidate generator for the attribute harness instead
   of guessing from CLI names. Probes then confirm write behavior and
   version scope.
3. Add a `.jg` version diff to show which fields each RouterOS release
   adds or drops. This could also track the 7.25 `title` minification break
   from `work/2026-11-winbox3-patches/README.md`.
4. Read WebFig's `wfig.js` for the query start/poll/cancel, subscription,
   terminal and Safe Mode behavior that mrz said OldBox was checked
   against. m2ir does not cover Safe Mode yet. Subscription, notification
   and autorefresh are now recorded (step 3); actions, Safe Mode and
   terminal are not.
5. Plan step 5: the decrypting MITM proxy, to see what WinBox 4 itself
   sends (subscribe words, MOVE shape, polling).
6. Widen the `[17]` oracle past wave 1 (34 menus, 30 routes) toward the
   470 7.25 base-package routes with no handler, then cover extra
   packages (plan step 4c).
