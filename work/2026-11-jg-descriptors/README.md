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
is about 7.1k, 9.3k and 11.8k field ids. `gui-handlers.yaml` models 356
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

[`undo-oracle.ts`](undo-oracle.ts) subscribes to `[17]` natively and makes
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
6. Candidate plan step: the `[17]` undo-history oracle above, run across
   the menus of the 470 7.25 routes with no handler to seed route, command and typed
   keys with CLI names.
