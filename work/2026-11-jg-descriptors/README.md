# .jg UI descriptors as an attribute source

<!-- cspell:ignore typevalue nonpublic getcmd roteros athhw igmp mrz webfig -->

Status: exploratory, 2026-11-21. Nothing here has been promoted into
`profiles/winbox-ipc/*.yaml` yet. [`gui-handlers-vs-jg.md`](gui-handlers-vs-jg.md)
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
   against. m2ir does not cover Safe Mode yet.
