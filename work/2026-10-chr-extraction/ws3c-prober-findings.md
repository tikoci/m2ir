# WS-3C live prober findings (7.25 + 6.49.23)

Live WinBox-wire interrogation of two quickchr CHRs — `twin3` (7.25,
pre-existing stopped lab machine, booted for this work) and `ws3c6`
(6.49.23, created for this work) — with a from-scratch Bun/TS prober.
900+ authenticated sessions, zero unexplained failures.

Prober: `ws3c/` in this directory — `ec-srp5.ts` (client math, vendored
from tikoci/centrs constants with minimal-length `bin()` per
libucrypto), `chunk.ts` (transport framing + streaming reader), `m2.ts`
(nv::message codec), `session-crypto.ts` (keys + envelope),
`probe.ts` (`auth|getone|getall|sweep|hscan|redp1sweep`). Evidence
transcripts: `ws3c/ev/` (one JSON per key reply + hscan maps + sweep
logs). Run: `bun ws3c/probe.ts --quickchr twin3 sweep`.

## 1. Auth, handshake framing, salt lifecycle

- MarginResearch framing is exactly right: handshake messages are single
  `[len:u1][0x06][payload]` chunks and the payload has NO inner 0x06
  (`username‖0x00‖33B-pubkey`, 49B server-key‖salt, 32B confirms).
  First-try auth against both CHRs.
- The schema's inner `tag: contents [0x06]` in the assembled handshake
  payloads is WRONG: `--inner-tag` (payload prefixed with 0x06) is
  rejected (server confirmation mismatch — the server hashes the 0x06
  into the username). The 0x06 is the chunk tag only. WS-4 correction.
- MSCHAP-33 branch never observed (all server phase-1 replies 49B SRP,
  both versions, ~950 logins). The `generateResponse` 33/49 dispatch is
  client-side (mproxy-as-client); the server always speaks SRP here.
- **Salt lifecycle is version-divided** (refines grounding §2, whose
  "fresh randomness per login" inference was wrong):
  - v7: salt is random-16B generated at user-create and at every
    password-set, stored persistently (survives reboot, verified for
    two users), stable across 100+ logins over an hour. 300 password
    rotations → 300 distinct salts, 300/300 logins OK
    (`ev/7.25-rot-sweep-300.log`).
  - v6: salt ROTATES without reboot or password change. Bisected to
    an idle timeout T in (15s, 20s] (10s/15s idle → same salt; 20s/45s/
    60s (6/6) idle → fresh salt), refreshed by logins: 300 rapid
    logins (~0.5s gaps) hold one salt, so it is idle-since-last-use,
    not wall-clock buckets (buckets would have rotated mid-sweep).
    Continuous uptime throughout — no reboot involved.
- REDP1 iteration counts over the 300-rotation series: 1×150, 2×69,
  3×41, 4×22, 5×8, 6×5, 7×3, 8×1, 9×1 — geometric with p≈0.5,
  exactly as theory predicts (≈50% on-curve per candidate).

## 2. Minimal-length encodings PROVEN (grounding §7c)

Both halves of the padded-vs-minimal question settled live with the
prober defaulting to minimal-length `bin()` and computing the padded
variant alongside as a discriminator (`encodingsAgree`):

- z (shared-point encoding): 9 instances with leading-zero z (zLen 31:
  2 on v6 run 1, 3 on v6 run 2, 4 in v7 rotation) — server ACCEPTED all.
  A padded-32 client derives a different secret/confirms on these and
  would fail (~1/256 of logins).
- REDP1 preimages: 2 instances in the v7 rotation (i=69, i=168) where
  the REDP1 points differ between encodings (same 1/1 iteration count,
  zLen 32) — server ACCEPTED both. REDP1 divergence needs varying
  xGamma, hence only observable via rotation (v7) — fixed-salt repeats
  can never show it.
- Totals: 900+ logins (600 v6 plain + 300 v7 rotation + ~150 ad-hoc),
  11 DIVERGE-ok, zero failures. Minimal-length is what RouterOS
  computes. tikoci/centrs `ec-srp5.ts` (padded-32 port) needs the §7c
  fix before it can do WinBox auth — worth an upstream issue.

## 3. Codec, envelope, source-id adoption

- The prober's M2 encoder reproduces MarginResearch's captured
  WinBox.exe first message byte-for-byte (asserted on every login when
  the adoption guess is 11): `REPLYEXP,REQID,CMD=7(u8),TO=[13,4],
  FROM=[0,11]`. Field order + compact-u8 CMD match the real client.
- Adoption is pure ECHO on 7.25: guesses 8/11/42/77 all returned
  verbatim, including a second overlapping session with the same guess
  (no correction, no uniqueness enforcement). v6: same echo (11 only
  tested). The private impl's "server corrects" never triggers here.
- New envelope key `0xff001c`/string-array, v7 only: every v7 reply
  carries `["msg-proxy-7.25"]` (the proxy stamps its version); v6
  replies lack it (v6 envelopes are slimmer: no 0xff001c anywhere).
  Do not confuse with row field `0xfe001c` (below).
- SYS_TYPE=2 (REPLY) + SYS_REQID echo on all replies, both versions.
  Error shape: SYS_STATUS=2 (ERROR) + SYS_ERRNO; errno names used here
  are the std-errors.yaml ones (BRKPATH/NOTIMP/UNKNOWNID/FAILED).
- Compact pairs live: u8 (0x09) for small u32s, string_c (0x21) for
  short strings, wide (0x20) for long ones (defconf scripts), u8-vs-u32
  switching by magnitude (bridge mtu auto=0/u8, 9000/u32).

## 4. system-resource [24,2]: static decode perfect, v6/v7 drift noted

The v6 live reply matches the static v6 decode field-for-field,
including every derived-quantity arithmetic check: used-hdd
(total−free), free-hdd pct, total/free memory MiB + deci-MiB,
total/free disk MiB + deci-MiB (rounding!), jiffies ≈ uptime×100
(100 Hz), write-sect total = since-reboot + persisted base (base=1 on
v6; 0 on v7's fresh boot). Idle-skip rules confirmed both ways: field 6
(cpu-load-B) absent at 0% (v7), present at 1% (v6 boot); field 23
(bad-blocks) absent on disk-backed CHR (both).
`ev/{6.49,7.25}-getone-24-2.json`.

v6→v7 drifts inside [24,2]: build-time format (`Oct/07/2026 16:05:16`
vs `2026-10-22 14:12:00`), board-name verbosity (`CHR` vs `CHR QEMU
Standard PC (i440FX + PIIX, 1996)`), version channel suffix
(`6.49.23 (stable)` vs bare `7.25`), field 45 (0x2d) present on v7
(`7.1`) but empty/absent on v6 CHR — v7's value equals REST
`minimum-version`, so field 45 may be minimum-version rather than
factory-software (WS-4: rename candidate).

## 5. identity [24,1] and routerboard [24,17]

- BOTH versions return identity as TWO fields: 12=name, 13=version —
  v6 `{12:"MikroTik", 13:"6.49.23"}`, v7 `{12:"CHR", 13:"7.25"}`
  (REST-confirmed names). The schema's single-field (12) entry is
  missing field 13 (version). WS-4 correction.
- [24,17] answers BRKPATH (from=[24], looper default) on BOTH versions.
  Combined with the 149-ELF static wall (no RB row-shape anywhere),
  the schema's routerboard sys-to is version-drifted or wrong for
  6.49.23 and 7.25 alike. No sys2 handler on either version has an
  RB-shaped reply (full hscans, §8). Where RouterOS keeps
  /system/routerboard over M2 remains OPEN (candidate: text-only via
  terminal, or a non-sys2 process — both not yet hunted).

## 6. license [65]: default-handler {12,13}, both versions

Bare `[65]` (no handler id) answers from the process-65 looper default
(no numbered handlers 0–8 on either version — consistent with static
keyman importing no addHandler): `{12:u8 0, 13:software-id}`. The
field-13 string equals REST `/system/license` system-id exactly
(10-char ID, recorded in `ev/7.25-getone-65.json`). Field 12 = 0
plausibly nlevel for CHR-free
(unconfirmed — no numeric level in REST to compare). The schema's
{1:software-id, 4:nlevel} matches NEITHER version; note the v6 keyman
static builder touches str {1,8,10,11,12,13} + u32:4, so a fuller row
(incl. 1/4) may exist behind another selector — the bare-GET subset is
{12,13}. [65] GET_ALL → NOTIMP (GET-only). WS-4 correction.

## 7. Rows: be32 proven, session bools confirmed, MTU fields

- **be32 CONFIRMED live** (both versions): ip-address fields arrive as
  tcode u32 whose bytes are network-order — LE-read values must be
  byte-swapped (10.0.2.15 → 0x0F02000A, /24 mask → 0x00FFFFFF,
  192.0.2.1/10.0.2.0/10.0.2.255 rows all verify). Field ids match the
  schema: 1=address, 2=network, 3=netmask, 4=broadcast, 5=interface
  (references interface row-id, verified). Schema's "host byte order
  little-endian" note is wrong — bytes are big-endian. WS-4.
- **0xfe0007=dynamic, 0xfe000a=disabled, 0xfe0008=invalid** — all three
  proven by experiment (DHCP row dynamic=true; disabled bridge flips
  0xfe000a false→true + running true→false; address on the disabled
  bridge flips 0xfe0008 false→true; REST cross-checked each). v6 sends
  neither bool when false; v7 sends 0xfe000a=false (presence drift).
  Interface rows: 0xfe0007 present only on some types (bridge yes,
  ether/lo no); 0xfe000a on all v7 rows.
- MTU triple: 100=config (0=auto as u8, else u32), 105=actual-mtu.
  Field 101: seen ONLY as 65535 on an enabled v7 bridge; absent on
  ether/lo/vlan (both versions) — CHR virtio has no l2mtu property in
  REST either, so schema's 101=l2mtu is unobservable here and the v6
  "5 sites" do not put 101 in rows. Keep-with-caveat: likely correct
  for hardware ether (l2mtu≈1598), unproven.
- Disabled rows are SLIM: disabling the bridge dropped computed fields
  (101/105/default-name/counters) until re-enabled. Row shape is
  state-dependent, not fixed per handler.
- MAC appears twice per interface row (0x3e9 always + a type-specific
  second field: 0x404 on ether, 0x82 on bridge, equal values here).
- ip-address field 10 always equals field 5 (interface id) across 4
  rows — either a duplicate or actual-interface (never discriminated;
  needs a row where interface≠actual).
- ipv6-address [20,37] matches the static v6 candidate exactly:
  {1:bytes16, 2:u8 prefix-len, 3:u8 interface} + extras {5,7:u8,
  4/6/9/0e/0f:bool F, 0x10:T, 8:"", 0x11/0x13:u8 0} (two rows: ::1/128
  on lo, fe80::EUI-64/64 on ether1 — EUI-64 derived from the live MAC).
- More 0xfe vocabulary: 0xfe0001=row-id, 0xfe0009=comment (both as
  schema'd), 0xfe0010=mark name ([20,13]/[20,14] rows `{id,
  0xfe0010:"no-mark"|…}`), 0xfe0019=TOTAL row count (present even on
  error replies; absent on [20,0] — handler-specific), 0xfe000b/bool
  (seen on [24,24] updater reply), 0xfe001c/string-array tags (seen as
  `[]` on a bridge row and `["disabled"]` on v6 [16,20]/[16,30]).

## 8. GET_ALL semantics: bare works; start is per-handler opaque

- Bare GET_ALL (no extra fields) works on every list handler tried, both
  versions. The gui-handlers "some builds require flags" fixture is
  unnecessary on 6.49.23/7.25.
- The fixture's fields decoded: 0xfe0004 = COUNT (head-limit; 0 rows
  when 0 — the fixture's count=0 is what empties the reply on 7.25),
  0xfe000c = flags (values 0/5/0x20000000 all return byte-identical
  replies — ignored for content here). USER-namespace (0x00) versions
  of both are ignored entirely.
- count=N returns head-N + `0xfe0003`=next-token when truncated;
  echoing the token as start continues correctly (count=1 → next=1 →
  start=1 returns the remaining row). The working pagination loop is:
  bare (or count) → follow 0xfe0003 tokens. The libumsg "start/count/
  next-start" triple is real; only start's *arbitrary-value* semantics
  are per-handler:
  - [20,1]: start is a VALIDATED row-id cursor (inclusive): s=0 or
    s=nonexistent → UNKNOWNID error (+total count); s=1 → the id-1 row.
  - [20,0]: start is OPAQUE — a full s=0..8 matrix over 3 rows
    (deterministic, reqid-independent, order-stable) fits no function
    of (id,s), no single row field, no skip/limit, no bitmask tried
    (~40 min of fitting): s∈{0,1}→all-but-ether1, s=2→all, s∈{3,4,5}→
    bridge-only, s≥6→empty. Only server-issued tokens are meaningful.
    Static follow-up: v6 net-0's REAL slot-14 getall (the analyzed
    "slots 9–17 = base" vtable is wrongly paired — getall demonstrably
    works on v6, so slot 14 is overridden; the slot-19 pagination case
    feeds private cmds 2–12, not GET_ALL).
    RESOLVED post-WS-4 (static re-visit, 2026-10-31): no slot-14
    override exists — net-0 overrides handleCmd at slot 7 and routes
    GETALL to a custom worker; start = lower_bound(row-id),
    inclusive, iterating in creation order. The matrix fits given
    bridge id 5 and is v7-only-consistent. See
    net-bridge2-handler-tables.md §8.
- 0xfe001d (first-row-id on truncated?) never observed — no truncation
  shape needed it (count≥rows in all truncated tests but one; the
  count=1/2-row case carried only 0xfe0003).

## 9. Handler maps live (hscan; maps in `ev/*hscan*`)

- sys2 (24): v6 = EXACTLY the static 17
  {0,1,2,5,6,7,8,9,10,12,14,15,16,23,24,25,31} — census methodology
  validated 17/17 end-to-end. v7 = 14 (drops 5,6 + 9; 9 served small
  flags `{12:[],4:F,5:0,1:1,2:0}` on v6, 5/6 were NOTIMP-only).
  Data-vs-NOTIMP split on v7: data {0,1,2,8,10,14,16,24,31}, NOTIMP
  {7,12,15,23,25} (same NOTIMP set on v6).
- net (20): v6 = 76 live (75 in 0–95 + 103/NOTIMP) + 3
  registered-but-BRKPATH {37,38,60} = 79 static reconciled (those three
  are package/version-gated, not reachable on this CHR). v7 = 84 in
  0–95 + 26 in 96–130 (101–107,109–117,120–122,124–130 minus
  {96–100,108,118,119,123}) — net roughly +50% handlers,
  mostly NOTIMP stubs + 6 thin data singletons (§10). v7 has 37/38/60;
  v6 lacks them live. Both have [20,62]→[10,1]: a cross-process proxy
  (request to [20,62] answered from=[10,1] with discover-1's FAILED).
- bridge2 (16): v6 = 15 in 0–31 {1,2,3,5–13,20,30,31} (static said 18 —
  3 more above 31, not scanned); v7 = 13 {1,2,3,9–18}. [16,2]=port and
  [16,13]=vlan exist both (empty here — no bridges at scan time).
- user (13): identical both {1,2,3,4 NOTIMP (4=auth: legacy CMD only),
  5=data `{5:[],1:F,2:T,4:1,3:0}`, 6/7=FAILED, 8=NOTIMP}. No user LIST
  via GET/GET_ALL on 0–8 (GET_ALL→NOTIMP); user-list path not explored.
- keyman (65): no numbered handlers either version (default serves).
- discover (10): v6 {0,1,2}, v7 {0,1,2,3} (v7 gained handler 3).
- mproxy (2): identical both ([2,1]=`{2:u32 0x2000000}`, [2,2]=NOTIMP
  file-transfer; unknown-id errors come back shorter (nfields 5, full
  path echoed) than other loopers).
- mepty (76): process exists BOTH (default NOTIMP for GET), no numbered
  handlers 0–6 either — terminal speaks private cmds on [76] bare.
  The 0x0a-top-byte question needs a terminal session (follow-up).

## 10. New handler identifications (values + REST cross-checks)

- [24,0] = clock (field 7 = unix time, 26 = "manual" = REST
  time-zone-name, 30/31 = seconds-since-midnight + day-start).
- [24,8] = default-configuration scripts (defconf bodies verbatim).
- [24,24] = updater (`{1:"7.25", 6:"NEWESTa7.stable", …}` + 0xfe000b).
- [20,17] = neighbor discovery-settings (field 79 = "lan" =
  add-dns-entries-suffix + 30000ms discover-interval; 114 user fields).
- [20,13]/[20,14] = packet-mark / connection-mark registries (proven by
  adding one mangle rule of each kind; rows `{id, 0xfe0010}`).
- v7-only net singletons (thin defaults on minimal CHR, shapes in
  `ev/7.25-hscan-20-hi.txt` + §8 dumps): 107 (field 5 = "firmware"!),
  114, 115 (empty data), 122, 125, 126. Roles open.
- Unknown singletons kept raw in ev/: [24,10] `{1:F,2:F}`, [24,14]
  `{8:F,9:T,15:0}`, [24,16] `{1:2,2:10}` (v6 said chfont — unconvinced),
  [24,31] (5 range-rows + `"7.13+,6.49.8+"` + 16B blob), [13,5], [2,1].

## 11. Static-note corrections queued (chr-extraction notes, not schema)

- net-bridge2: net handler-0 vtable wrongly paired — "slots 9–17 =
  base (NOTIMP)" refuted (GET_ALL works on v6 [20,0], so slot 14 is
  overridden; the row-core 0x80f6738 finding itself stands — live rows
  match it). The slot-19 pagination case belongs to private cmds 2–12.
  CORRECTION (2026-10-31): the pairing was RIGHT (vtable 0x8113888,
  all 17 PLT-resolved) — the error was assuming base dispatch. Net-0
  overrides handleCmd at slot 7. See net-bridge2-handler-tables.md §8.
- ucrypto-grounding §2: salt is NOT fresh randomness per login on v7
  (persistent per password-set) — and on v6 it is an idle-expiring
  ephemeral ((15,20]s), neither "fresh per login" nor stored.
- net-bridge2: field 101 "5 sites" do not put 101 in ether rows on
  either version (observed only on v7 bridge as 65535).
- sys2-handler-tables: v6 census CONFIRMED 17/17 live; v7 delta is
  −{5,6,9} (data point for the v7 map, which has no static extraction
  here).

## 12. WS-4 schema corrections queued (extends the §7(a–e) list)

Prior: j client-X-first; server enforces MAC+pad; minimal-length
redp1/z (now PROVEN live, §2); makeChallenge is MSCHAPv2's; no scalar
clamping. New from WS-3C: (f) handshake payloads have NO inner 0x06
(chunk tag only); (g) salt lifecycle: v7 persistent per password-set,
v6 idle-expiring ≈15–20s (both replace "fresh randomness"); (h) IPv4
fields are be32 (bytes big-endian), not LE; (i) identity gains field
13 = version; (j) license bare-GET is {12:nlevel?, 13:software-id}, not
{1,4}; (k) [24,17] routerboard answers BRKPATH on both versions —
sys-to needs version scoping or removal; (l) interface MTU: 100=config,
105=actual, 101=l2mtu unobserved-on-CHR caveat; (m) new SYS key
0xff001c (v7 proxy banner); (n) 0xfe0010=mark name, 0xfe0019=total
count, 0xfe0008=invalid (+0xfe000b, 0xfe001c sightings); (o) GET_ALL:
bare works, count=head-limit, 0xfe0003=next-token/start with
per-handler cursor semantics ([20,1]=row-id-validated), 0xfe000c
ignored, USER-ns extras ignored; (p) source-id adoption = echo (drop
"server corrects", or scope it); (q) v7 sys2/net handler deltas +
[20,62]→[10,1] proxy; (r) resource field 45 = minimum-version?
(rename candidate), build-time/board-name/version-channel v6/v7
formats; (s) MSCHAP-33 never served (scope the dispatch note
client-side).

## 13. Open threads (not WS-3C regressions — explicit non-goals/follow-ups)

- ~~GET_ALL start on [20,0]: opaque cursor (s-matrix in §8; server tokens
  only). Static target: v6 net-0's REAL slot-14 (+v7 equivalent).~~
  RESOLVED 2026-10-31: start = lower_bound(row-id), no slot-14
  override (slot-7 handleCmd dispatch instead); see
  net-bridge2-handler-tables.md §8. Live batch §15 closed v6
  count=0→all and the 0x10001-filter leg (both versions).
  Remaining: v7 worker byte caps, v7 finish-path static decode.
- Routerboard location over M2 (both sys2 maps clean).
- Unknown singletons (§10 tail) + v7 high-net roles + [13,5] + [2,1].
- User-list path; [20,61]/[13,6]/[13,7] selector-gated handlers
  (GETOBJ support needed in prober); [20,115]-style empty-data GETs.
- ip-address f10: interface-dup vs actual-interface (needs
  interface≠actual row); license f12: nlevel proof (needs tiered
  license); mepty terminal surface (0x0a question).
- ~~Upstream: tikoci/centrs#§7c (padded-32 REDP1/z) — file with the
  11/900 divergence instances.~~ FILED 2026-10-31 as
  [tikoci/centrs#565](https://github.com/tikoci/centrs/issues/565)
  with the 11/900 instances + redp1-input close-out (fixed-32B,
  exactly two fix sites) + deterministic regression vector
  (`srp5-minimal-vector.json`, z edge, centrs cross-checked).

## 14. Lab state

- twin3 (7.25): rebooted once (salt-persistence check); all lab
  artifacts removed (bridge/vlan/address/mangle rules, `ws3c` user).
  Left STOPPED (its pre-session state).
- ws3c6 (6.49.23, x86, user-net, WinBox port 9165): created for WS-3C;
  no config changes made (admin/empty). Left stopped-but-present for
  follow-up sessions. Reboot with `quickchr start ws3c6`, probe with
  `bun ws3c/probe.ts --host 127.0.0.1 --port 9165 --user admin
  --pass '' …`.
- All findings cross-checked between M2-live and REST/native reads
  where a second source exists; single-source items are marked above
  (unconfirmed / sighting / candidate).

## 15. Post-WS-4 live verification batch (2026-10-31)

One CHR session (twin3 + ws3c6 booted, probed, stopped; no config
changes, no password rotations) confirming the net-bridge2 §8 static
predictions. New transcripts: `ev/6.49-getall-20-0-{count0,start0,
start1,start2,filt1,filt999}.json`,
`ev/7.25-getall-20-0-{start1,start2,count1,count0,filt1,filt76,
filt999}.json`, `ev/6.49-redp1sweep-{400,padded-400}.log`.

- v6 count=0 → ALL rows (1/1, `0xfe0004=1` echo): the
  count-1->1000 clamp live-proven. The count=0 version drift is now
  live both sides.
- v6 start: s=0,1 → [ether1], s=2 → [] (with `0xfe0004=0` echo):
  lower_bound inclusive + beyond-max-empty, live.
- v7 start (discriminating): bare [ether1(2), lo(1)]; s=1 → [lo]
  ONLY; s=2 → [ether1, lo]. Lower_bound + creation-order iteration
  confirmed on demand — start selects by id, iteration skips
  earlier-created rows.
- v7 count=1 → [ether1] + token `0xfe0003=1`, no `0xfe0004` echo:
  v7 finish path differs from v6 (token-only truncation).
- NEW QUIRK v7 count=0 → 0 rows + token `0xfe0003=1` (the SECOND
  entry's id): the worker advances past the first entry before the
  count-exhausted check, so following a count=0 token SKIPS the
  first row. Consistent with the v6 finish-path mechanics; v7
  finish path itself still undecoded.
- `0x10001` exact-match filter live BOTH versions: v6 =1→[ether1],
  =999→[]; v7 =76→[lo], =1→[ether1], =999→[]. Entry+0x60 ==
  row field 0x10001 confirmed behaviorally (ether type 1,
  loopback type 76). The 0x10002/3 + mask bitmask legs remain
  static-only (untested).
- Centrs A/B (for upstream
  [tikoci/centrs#565](https://github.com/tikoci/centrs/issues/565)):
  v6 `redp1sweep 400` minimal → 400/400 ok (2 divergeOk);
  `--padded32` → 399 ok + 1 divergeFail (`server confirmation
  mismatch`) with 0 divergeOk. Padded-32 confirms are causally
  rejected; posted to the issue.

Still open from §13: v7 worker byte caps (needs a >50KB table —
no 50-interface lab exists), v7 finish-path static decode,
routerboard location, unknown singletons, GETOBJ/terminal surfaces.
