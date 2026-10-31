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
- ~~ip-address field 10 always equals field 5 (interface id)~~
  DISCRIMINATED (§17): bridge-port enslavement splits them —
  **f5 = actual-interface, f10 = configured interface** (the old
  labels were swapped). Equal whenever interface==actual.
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
  validated 17/17 end-to-end (plus hscan 32–40: all BRKPATH,
  census ends at 31). v7 = 19: the 14 in 0–31 (drops 5,6 + 9;
  data {0,1,2,8,10,14,16,24,31}, NOTIMP {7,12,15,23,25}) PLUS
  33/34/35/36/38 (static census 18 sites + live 34) — 33 data,
  34 UNKNOWNID (selector-gated), 35 empty-data, 36 NOTIMP,
  38 FCC text. See §17.
- net (20): v6 = 76 live (75 in 0–95 + 103/NOTIMP) + 3
  registered-but-BRKPATH {37,38,60} = 79 static reconciled (those three
  are package/version-gated, not reachable on this CHR). v7 = 84 in
  0–95 + 26 in 96–130 (101–107,109–117,120–122,124–130 minus
  {96–100,108,118,119,123}) + 134 (mark-registry-shaped; 4
  mark-kind negatives, §17) — net roughly +50% handlers,
  mostly NOTIMP stubs + 6 thin data singletons (§10). v7 has 37/38/60;
  v6 lacks them live. Both have [20,62]→[10,1]: a cross-process proxy
  (request to [20,62] answered from=[10,1] with discover-1's FAILED).
  v7-only second proxy shape: [61,H]→[1025,H] (pid-1025 quirk, §17);
  truly-unknown v7 pids (1,60,62,999) time out with NO reply.
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
  Batch §17 adds: [24,33] `{501:"",502:T,503:F}`, [24,35] (empty
  data), [24,38] = FCC Part 15 text (IDENTIFIED), [20,134]
  mark-registry-shaped (4 negatives), v6 [61,1]={1:F} / [61,2]={}.

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
  Batch §16 closed the rest of the static program: v7 finish
  path (token-only, no 0xfe0004 echo — the single v6/v7 worker
  delta), v7 byte-cap constants (identical 49999/60000 +
  pre-checks), all mask-filter legs live both versions, and the
  row-core entry→field map. Batch §17 closed live truncation
  (306-row table: 194 + token → 112, sound, no gaps/dups) and
  REFUTED the iteration "creation order" model (102-row bare
  puts lo last; no tested key fits — static key hunt open).
  Batch §18 SOLVED the key live: slot-0 = first-created
  interface (rename-proof), rest = name-ascending (f6) —
  proven over 4 renames + del/add + reboot on an 8-row
  table, fitting all tables (2/3/8/102/106/306 rows).
  SUPERSEDED by batch §19: the head+tree model is DEAD;
  behavior is the dual-mode crossing-gated rename fixup
  (R1–R4, day-0-NIC-gated). Mechanism (static
  fixup-branch) + v6-iteration stay open.
- ~~Routerboard location over M2 (both sys2 maps clean).~~
  NARROWED 2026-10-31 (batch §17): v6 rbbios ANSWERS direct
  queries ([61,1]={1:F}, [61,2]={} — the "server-dead" verdict
  is corrected to "relay-absent, handlers live"); v7 routes
  pid-61 to pid-1025 (quirk, open). The FULL RB row-shape
  (model/serial/firmware) is still homeless on both.
- ~~Unknown singletons (§10 tail) + v7 high-net roles + [13,5] +
  [2,1].~~ NARROWED 2026-10-31 (batch §16, full dumps both
  versions): [13,5]/[2,1]/[24,14]/[24,16] stable cross-version
  (roles still open); [24,10] stable drift (v6 2:T vs v7 2:F);
  [24,31] dramatic drift (v6 {10:0} vs v7 5-row + blob +
  "7.13+,6.49.8+"); 114/115/126 = one 0xfe-family
  ("default"/"disabled" + new 0xfe0029). Batch §17:
  [24,38] IDENTIFIED (FCC text); new v7 handlers 33/35/38/134
  dumped (33/35/134 roles open); 134 survives 4 mark-kind
  negatives. Remaining: [24,10/31/33/35], 107/122/125,
  114/115/126-family, 134, pid-1025. Batch §18: [24,31]
  IDENTIFIED (ROSMode/SafePkgs gate) + hidden
  0xfe000c-bit-28 leg live; 134 at 11 negatives
  (same-class as 13/14); 9/9 perturbation-negatives for
  [24,10/33/35] + 107/122/125 + 114/115/126-family.
- User-list path; [24,34]/[20,61]/[13,6]/[13,7]
  selector-gated handlers (GETOBJ support needed in prober).
  PARTIALLY CLOSED 2026-10-31 (batch §18, prober gained
  GETOBJ + getone --xfield): [24,34] = security-advisory
  registry (GETOBJ-only, 1 advisory); [20,61] narrowed to
  net/modem_aux (CHR-absent); [13,6/7] still gated (GET→
  FAILED, GETOBJ/GETALL→NOTIMP); user-list path still open.
  CLOSED 2026-10-31 (batch §19): [13,6/7] = UserPrefs
  (username-selected; SET-overwrites-whole-record;
  round-trip + orphan-survives-delete proven; WinBox/
  WebFig split open); [13,1/2/3/4,8] = users/groups/
  policies/sessions/default; [13,4] is dual-role (GET
  adopts source-id + GETALL lists sessions).
- ~~ip-address f10: interface-dup vs actual-interface (needs
  interface≠actual row)~~ CLOSED 2026-10-31 (batch §17):
  bridge-port enslavement splits them — **f5 =
  actual-interface, f10 = configured interface** (labels were
  swapped). License f12: nlevel proof (needs tiered license —
  likely untractable); mepty terminal surface (0x0a question).
- ~~Upstream: tikoci/centrs#§7c (padded-32 REDP1/z) — file with the
  11/900 divergence instances.~~ FILED 2026-10-31 as
  [tikoci/centrs#565](https://github.com/tikoci/centrs/issues/565)
  with the 11/900 instances + redp1-input close-out (fixed-32B,
  exactly two fix sites) + deterministic regression vector
  (`srp5-minimal-vector.json`, z edge, centrs cross-checked).

## 14. Lab state

- twin3 (7.25): rebooted once (salt-persistence check); all lab
  artifacts removed (bridge/vlan/address/mangle rules, `ws3c` user).
  Left STOPPED (its pre-session state). Batch §18:
  factory-reset via `quickchr clean` after a self-inflicted
  VRF isolation (see §18); all §18 artifacts removed;
  baselines re-verified (2 interfaces, 1 addr, 0 mangle/filter,
  1 user). Left STOPPED.
- ws3c6 (6.49.23, x86, user-net, WinBox port 9165): created for WS-3C;
  no config changes made (admin/empty). Left stopped-but-present for
  follow-up sessions. Reboot with `quickchr start ws3c6`, probe with
  `bun ws3c/probe.ts --host 127.0.0.1 --port 9165 --user admin
  --pass '' …`.
- Batch §19 lab: twin3 (7.25) + ws19-2nic (7.25 2-NIC)
  after the dual-mode series, twin4 (fresh 7.26b3 1-NIC —
  pre-existed dirty with dockers/veth residue, cleaned),
  ws20 (fresh 7.25 2-NIC), ws21 (fresh 7.25 3-NIC). All
  names restored, all test objects removed, baselines
  re-verified (twin3 2/1/0/1; ws19 3 interfaces; ws20 3;
  ws21 4; twin4 2). All STOPPED. twin1 was found
  RUNNING (not ours, untouched) and later observed
  stopped without our action (cause unknown).
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

## 16. Mask-leg + singleton batch (2026-10-31)

One CHR session (twin3 + ws3c6 booted, probed, stopped; no config
changes). Static setup: the row-core maps entry offsets directly to
row fields (entry+0x14 → `0x10002`, +0x1c → `0x10003`, +0x60 →
`0x10001`; see net-bridge2 §8 "Filter legs"), so every mask test
below was designed from bare-row values (ether1
`0x10002=270947/0x10003=542529` both versions, v7 lo `0/525633` —
stable across boots). New transcripts: 16×
`ev/{6.49,7.25}-getall-20-0-m{14,m1c}*.json`, 15×
`ev/{6.49,7.25}-getone-{24-10,24-14,24-16,24-31,13-5,2-1,
20-107,20-114,20-115,20-122,20-125,20-126}.json`.

- `0x10002` leg live BOTH versions, all 5 predictions confirmed:
  exact+full-mask → [ether1] both; =0+full → v7 [lo], v6 []
  (discriminating); =999999 → [] both; val-only (default mask =
  val) → [ether1]; =0 val-only (default mask 0) → bare-equivalent.
- `0x10003` leg live BOTH versions, all 5 predictions confirmed:
  exact+full-mask → [ether1] both; lo-value+full → v7 [lo], v6
  [] (discriminating); hidden-select (=2, mask 2) → [] both (no
  hidden rows on clean CHRs — the leg itself is proven live);
  match-all (=0, mask 0) → bare-equivalent; val-only (default
  mask = val|2) → [ether1]. Both default-mask rules proven.
- v6 filtered replies carry the `0xfe0004` emitted-count echo
  (1 for 1-row, 0 for 0-row results); v7 carries none — the v6/v7
  finalize delta (net-bridge2 §8 "v7 finish path") holds for
  filtered GETALLs too.
- [24,10] is a STABLE version drift: v7 {1:F, 2:F}, v6 {1:F,
  2:T} (re-queried, both stable). Role still open.
- [24,14] {8:F, 9:T, 15:0} and [24,16] {1:2, 2:10} are
  byte-identical both versions. [13,5] and [2,1] v6 dumps match
  their v7 shapes exactly (stable cross-version).
- [24,31] is a DRAMATIC drift: v6 = single field {10:u8 0};
  v7 = 5-row array (field 5) + count 5 (field 6) + {10:0} +
  16B blob (field 0x20) + "7.13+,6.49.8+" (field 7). Rows 1–3
  fit u32 version encoding (0x08000000 = 8.0.0.0, 0x070D0000 =
  7.13.0.0, 0x06320000 = 6.50.0.0 — matching the field-7
  string); rows 4–5 break the pure-version reading (0x06318348
  pair, 1681455313 ≈ 2023-04 unix time). Either a
  version-scoped role change or an empty data source on v6.
- v7 high-net singletons, full shapes recorded: 107 (field 5 =
  "firmware", 15 = 120, 20 = 5, …), 122 (255-heavy: ten
  255/−1-valued fields), 125 (0x11 = [], 0x0e = 0xFFFFFFFF,
  …), and the 114/115/126 FAMILY — all three carry
  `0xfe0007=T/0xfe0008=T/0xfe000a=F/0xfe000d=T/0xfe0029=F`
  with `0xfe0010` = "default" (114/115) vs "disabled" (126).
  115 is a 0xfe-only message (no USER fields at all).
- NEW 0xfe vocabulary: **`0xfe0029`/bool** (F on all three
  family members); `0xfe000d`/bool (T) re-sighted.

Still open from §13 (updated): live >50KB truncation behavior
(constants now static-proven both versions — the lab need is
narrower), routerboard location, the [24,10/31], 107/122/125, and
114/115/126-family roles, GETOBJ/terminal surfaces, and the
f10/nlevel proofs. CLOSED this batch: v7 finish-path static
decode, v7 byte-cap constants, mask-filter legs (static-only to
live both).

## 17. Census + truncation + discrimination batch (2026-10-31)

One CHR session (twin3 + ws3c6 booted, probed, stopped). Config
changes were made and FULLY reverted (mangle rules, routing table,
VLANs ×300, bridge, VRRP, EoIP, IPIP, test addresses — REST +
M2 baselines re-verified: 2 interfaces, 1 address, 0 mangle
rules). Device ops via centrs; M2 via the ws3c prober. New
transcripts: 3 hscan maps + 12 JSON (high handlers, rbbios,
134-negative, f10, bulk pages).

- v7 sys2 static census: 18 addHandler sites
  {0,1,2,7,8,10,12,14,15,16,23,24,25,31,33,35,36,38} — FOUR
  high handlers above the §9 scan range, NO 17 (routerboard
  homeless confirmed statically on v7 too). Live hscan 32–40:
  33 data {501:"", 502:T, 503:F}, 34 UNKNOWNID (selector-gated,
  19th handler — static grep missed 0x22), 35 EMPTY data
  (bare-SYS-only success), 36 NOTIMP, 38 data {1:string} =
  the FULL FCC Part 15 statement (**[24,38] IDENTIFIED** as
  regulatory/FCC text). v6 hscan 32–40: all BRKPATH (census
  ends at 31 — negative control).
- v7 net: handler **134 EXISTS** (static + live): GET_ONE
  {0xfe0010:"no-mark"}, GET_ALL [{id:0, "no-mark"}] + total 1 —
  mark-registry-shaped. FOUR negatives: routing-mark (via new
  table + mangle rule), packet-mark, connection-mark, and IPv6
  packet-mark rules move [20,13]/[20,14] but NEVER 134. Bonus:
  IPv6 packet-marks share the [20,13] namespace (ip6mark row
  id 2). 134's driver is elsewhere (bridge NAT? routing
  rules? VRF?) or CHR-absent. Static follow-up: handler-134's
  store pairing.
- v6 rbbios is LIVE: [61,1] = {1:bool FALSE}, [61,2] = empty
  success, [61,3] NOTIMP (GET), GET_ALL → NOTIMP both (GET-only).
  CORRECTION to routerboard-hunt §7 "server-dead": the handlers
  were never CALLED by sys2, but they ANSWER direct queries —
  the sys2→rbbios relay is absent, not the handlers. [61,1]=F
  fits "RouterBOARD not detected on CHR" (unconfirmed — needs
  hardware to compare). The full RB row-shape (model/serial/
  firmware) is STILL homeless.
- v7 pid-61 → pid-1025 quirk (NEW, open): every v7 [61,H]
  answers from=[1025...] ([61,1]→BRKPATH from=[1025],
  [61,3]→NOTIMP from=[1025,3], bare [61]→NOTIMP from=[1025]),
  always with 0xff000b=-1 (SYS_POLICY super-admin = internal
  origin). Every [61,H] behaves EXACTLY as [1025,H] (alias or
  shared looper). 1025 itself: real looper, single handler 3
  (NOTIMP both verbs). Contrast: truly-unknown pids (1, 60,
  62, 999) → SOCKET TIMEOUT (no reply at all); existing pids
  (5, 63, 100) → BRKPATH from=[pid]. What 1025 is (compat
  shim? session pseudo-process? renamed board process?) is open.
- **f10 DISCRIMINATED — and the labels are SWAPPED**: bridge-port
  enslavement splits interface≠actual (192.0.2.4:
  interface=f10vlan2/id 6, actual=br-f10/id 5; disabled/VRRP do
  NOT split). The M2 row reads f5=5 (br-f10) + f10=6
  (f10vlan2): **field 5 = actual-interface, field 10 =
  configured interface**. All other rows have f5==f10. Schema
  correction queued (gui-handlers ip-address).
- **Truncation LIVE on 306 rows** (300 VLANs + 6): bare GETALL
  → 194 rows + token 0xfe0003=203 (no 0xfe0004/0xfe0019 —
  v7 token-only); start=203 → 112 rows, first=cap292(203),
  last=ord-vrrp, no token. Concatenation = 306/306 unique, no
  gaps/dups, order-continuous. Pagination sound end-to-end;
  ~260B/row → 102 rows fit, 306 don't. The [20,0] program is
  now closed except the iteration key (below).
- **Iteration order is NOT creation order** (model refuted):
  102-row bare = [ether1(2), cap100–199(7–106), lo(1)] — lo
  created 2nd iterates LAST. 106-row (+br 107, vrrp 108, eoip
  109, ipip 110) = [ether1, br, caps, lo, eoip, ipip, vrrp].
  Refuted: id-asc/desc, creation, type-asc (ord trio last),
  f2-desc, f3-desc (disabled cap150: f3→0, position UNCHANGED;
  br f3 ties lo's yet sorts 100 rows apart), running-first
  (same disable test). Within-type order stays id/creation
  (monotonic allocator — indistinguishable live). Static
  follow-up: iteration nodes embed at entry+0x24, root
  obj+0xac/0xb0 — find the insert comparator.
- v7 row-core anomaly (static follow-up): br-cap carries
  0xfe0007=False with entry+0x14 = 0x18223 (low byte 0x23,
  bit 0x80 CLEAR) — the v6 dynamic-presence rule (bit 0x80
  set) does not directly transfer; v7 row-core re-check needed.
- [24,31] static narrowing: handler-31 getter paired (v7 vtable
  0x808c98c, slot 9 = 0x805aaec); uses `nv::SafePkgs` +
  `ROSMode::saveMsg`. "6.49.8"/"7.13" in NO binary (field-7
  string fully dynamic). Role narrowed to a SafePkgs-adjacent
  package/mode gate — not proven. v7 `mode` binary: ZERO
  addHandlers (board strings not M2-served on v7).

Still open (updated): iteration-tree key (static), v7 row-core
dynamic gate (static), [24,31] role proof (SafePkgs lead), pid-1025
identity, routerboard full shape (homeless), [24,10/33/35] +
107/122/125 + 114/115/126-family + 134 roles, GETOBJ-gated
handlers ([24,34], [20,61], [13,6/7]) + user-list path, terminal
surface, nlevel proof (needs tiered license — likely untractable).

## 18. GETOBJ + iteration-solved + identity batch (2026-10-31)

One CHR session (twin3 + ws3c6 booted, probed, stopped) plus
static follow-ups. Prober gained `getobj <pid> <hid> [obj-id]`
(CMD 0xfe0002 + 0xfe0001) and `--xfield` on `getone`. New
transcripts: `ev/7.25-getobj-{24-34-1,24-2-0,24-2-1,24-2-2,
20-0-2}.json`, `ev/7.25-getone-{13-9,24-31-bit28,1,48-5,
24-0}.json`, `ev/6.49-getone-{24-0,48-5}.json`,
`ev/7.25-getall-20-0-iter{1..6}.json`,
`ev/6.49-getall-20-0-v6br.json`, `ev/7.25-pert-24-10-{pre,post}.json`
(exemplar pair; all 9 perturbation pairs diff-identical).

- **[24,34] IDENTIFIED — security-advisory registry.**
  GETOBJ obj=1 returns a single advisory record
  (`0xfe0008=T`, `0xfe0009`=description, `0xfe0010`=
  "Permissive ipv6 firewall traceroute rule"); obj 0,2–8 →
  UNKNOWNID. Exactly one advisory on 7.25. Bare GET stays
  UNKNOWNID (selector-gated = GETOBJ-only). v6: BRKPATH
  (v7-new).
- **[20,0] GETOBJ = fetch one row by id** (obj=2 → ether1
  row). **[24,2] GETOBJ = per-CPU sampler rows**: obj=0
  "cpu0", obj=1 "cpu1", obj≥2 UNKNOWNID — on a 1-vCPU CHR
  whose resource rows report cpu-count=1 and a 1-element
  field-34 array. The sampler serves 2 slots regardless
  (quirk; obj0 carries field-6 nonzero, obj1 field-9
  nonzero — mirroring the A/B load windows).
- **[24,31] role PROVEN + hidden leg CONFIRMED.** Static
  (v7 sys2 0x805aaec): field 7 =
  `nv::SafePkgs(msg).tostr()` (the "7.13+,6.49.8+" floor
  list); fields 5/6 copied from the ROSMode message;
  read-only (slot 10 = base cmdSet). Request `0xfe000c`
  bit 28 unfolds a nested `0xfe0024` mode message (32
  fields) — confirmed live; the sibling `0x78/0x79`
  feature/running arrays + u64 `0x66` need
  `rosMode()->hasFeature(0x12)`, false on CHR (partial
  leg, exact static mechanism). Role: ROS software-mode /
  safe-packages gate singleton.
- **Iteration key SOLVED: slot-0 = first-created
  interface, rest = name-ascending (f6).** 8-row table:
  order1 exactly lexicographic; bridge del/add (new id)
  keeps its slot; renames re-sort live (`ws18-br`→`aabr`
  moves before `lo`; `aabr`→`bridge` moves before `lo`);
  `ether1`→`a-ether`→`zz-ether` NEVER moves (pinned by
  identity, not name — `zz-ether` sorts last
  lexicographically yet stays first). Reboot-identical
  order + stable ids. The model fits every observed table
  (2/3/8/102/106/306 rows) with one inference: the §8
  3-row bridge (order [ether1, lo, bridge]) must have been
  custom-named >"lo" (a default-named `bridge` sorts
  before `lo`, proven live). v6 also head+tree ([ether1,
  bridge], 2 rows). The static +0x20-u32-key lead is
  RETRACTED for the iteration tree (those lower_bound
  helpers serve other +0xac trees; the iteration
  comparator is name-string — needs Ghidra, entry point
  recorded in net-bridge2 §8).
- **0x10004 = kernel ifindex** (strong): lo=1, ether1=4,
  sequential per creation batch, gap at a deleted
  interface (110), absent on VRRP (no kernel device).
- **v7 row-core fully decoded** (0x8064f1a): same ix<>
  sequence as v6 except 0x10066-string GONE from base
  (v7 type builders write 0x10066 as u32 — producer moved
  base→type, type string→u32); running rule identical
  ((w&0x500)==0x500, NOT+TEST idiom); dynamic gate
  IDENTICAL (bit 0x80 → present-True, else absent); NEW
  0xff001e insert (entry+0x40, when ≠ −1; unseen live —
  absent from all captured rows); shifted offsets
  (+0x180/+0x1c8/+0x1a8 vs +0x168/+0x1a4/+0x184).
- **Dynamic-gate "anomaly" RESOLVED as version drift in
  the bridge builder, not the row-core.** v6 bridge row:
  f2=0x18223 (same value as v7!), NO 0xfe0007 (base rule
  holds); v7 bridge row: explicit 0xfe0007=False. The v7
  bridge-type builder writes False; v6 omits. (The "Bonus"
  sentence originally here claimed v6 ether1 f2=0x42263 vs
  v7 0x42223 — RETRACTED in §19: 270947 decimal IS 0x42263;
  the "0x42223" was an arithmetic slip, both versions read
  270947 identically. No f2 flip exists; bit meanings stay
  open as background.)
- **134: same class as 13/14 (static) + 7 more live
  negatives (11 total).** v7 net builds 13/14/134 from
  one factory (max 0xfff/0xffff/0x7ffe, name "no-mark",
  adjacent registration; v6 has 13/14 only). Live: IPv6
  conn-mark → [20,14] (shares, like v6 packet-marks share
  13); bridge-filter mark → [20,13]; routing-table,
  route-in-table, routing-rule, VRF-with-member, and
  queue-referenced marks NEVER touch 134. Driver still
  unknown (remaining ideas: MPLS, CAPsMAN, LTE — out of
  CHR-lab scope).
- **pid-1025 narrowed (still unidentified).** Per-session
  REFUTED (concurrent held session still gets 1025);
  present on factory-reset box + across reboots (static/
  shared). Only pid 61 routes there — v6-only pids
  46/50/55/122 time out bare (46/50/55/122) or answer
  natively (48 = live console looper!). Handler-3-NOTIMP
  is unique to 1025 ([24,3] → BRKPATH). Bonus: concurrent
  sessions both adopt sourceId 11 (adoption is not
  per-session unique).
- **pid 1 / pid 48 surprises.** Bare [1] ANSWERS
  (from=[1], policy −1, empty success) but [1,H] times
  out for all H (a known pid with no handlers — refines the §17
  "unknown pids time out" note, which holds for
  60/62/999/46/50/55/122 but NOT bare-1). **[48,5] is a
  PROXY to [24,33]** (from=[48,5,24,33], same {501,502,
 503} shape) — while v6 [48,5] serves {501:"",502:T}
  NATIVELY (no 503, direct from). A v6→v7 handler
  migration with proxy-compat. 48's NOTIMP from-length
  flickers ([48] for H∈{0,1,7,11,12}, [48,H] otherwise —
  tentative: unregistered vs registered-unimplemented).
- **[13,9] is v7-NEW** ({1:u8 0, 2:u8 0}; v6 BRKPATH,
  rest of the user census identical). Not user/session
  count (stays zero with extra user + active session).
  v7 [24,0] = data singleton (18 fields, drifted from
  v6's [24,0] shape — both dumped).
- **[20,61] narrowed statically**: sibling store is
  `net/modem_aux` (near `net/apn`,
  `/nova/store/sms-config`) — a modem-aux/APN area
  handler, CHR-absent. Its GET selector (UNKNOWNID for
  bare and 0xfe0001-fielded GETs; NOTIMP for GETOBJ/
  GETALL) stays unknown. [13,6/7] likewise (GET→FAILED
  bare and fielded, GETOBJ/GETALL→NOTIMP).
- **Singleton perturbation: 9/9 negatives.** Identity +
  timezone + input-filter-rule + new user moved NONE of
  [24,10/33/35], 107/122/125, 114/115/126 ([13,9]
  likewise zero throughout). Pre/post pairs
  byte-identical (diff-verified; exemplar kept).
- **Lab incident (self-inflicted, recovered).**
  `/ip/vrf/add ... interfaces=ether1` moved the
  single management NIC into a VRF → all transports died
  simultaneously; the "non-booting disk" (2× BOOT_TIMEOUT)
  was really an unreachable guest (VRF-held ether1
  persists across reboot). Recovered via a `quickchr clean`
  plus start (factory-reset twin3; the 3 ws18 routing
  artifacts went with it — their 134 negatives stand as
  observed). Lesson: never touch ether1's membership on
  a single-NIC CHR; test VRFs with member VLANs instead.

Still open (updated): pid-1025 identity (narrowed:
static/shared, 61-only), routerboard full shape
(homeless), [24,10/33/35] + 107/122/125 +
114/115/126-family + 134 roles (134: 11 negatives,
same-class; perturbation-negatives for the rest),
[20,61]/[13,6/7] selectors (61: modem_aux lead),
user-list path, terminal surface, nlevel proof (likely
untractable), iteration-head identity refinement
(first-created vs first-ether — needs 2-NIC CHR),
0xff001e sighting (no live row yet), 0x10002 low-byte
flag meanings. CLOSED this batch: iteration key,
[24,31] role + hidden leg, [24,34] role, v7 row-core
deltas, dynamic-gate anomaly, GETOBJ verb surface.
SUPERSEDED BY §19 (2026-10-31): the "iteration key"
claim above (slot-0 first-created head + name-tree)
is DEAD — replaced by the dual-mode crossing-gated
rename fixup (R1–R4). Slot-0 is not identity-pinned
(ws19 entries/exits disprove it); there is no
name-tree re-sort on rename. The §18 transcripts
(iter1–6/2nic1–4) stand as re-interpreted (T1–T9)
in §19.

## 19. Selectors + prefs + user-lists + iteration-dual-mode (2026-10-31)

Two live sessions. §19a (prior): twin3 + ws3c6 —
routerboard REST gate, [13,6/7] UserPrefs selectors
with round-trip + orphan behavior, [13,1/2/3/4/8]
user-list GETALL maps, 0xff001e exotic-row hunt, f2
re-confirm, PPPoE 0x98 tcode (prober `m2.ts` +
`physical/nv-message.yaml`). §19b (this): twin3 +
ws19-2nic + fresh twin4/ws20/ws21 — iteration-head
refinement → DUAL-MODE crossing-gated rename fixup
gated on day-0 NIC count. 47 new transcripts:
`ev/7.25-getall-20-0-deep{0..24}.json`,
`ev/7.25-getall-20-0-2nic{5..19}.json`,
`ev/7.25-getall-20-0-{ws20-{1,2,3},ws21-{1,2},
twin4-{1,2}}.json`.

- **[13,6]/[13,7] IDENTIFIED — UserPrefs
  (username-selected prefs records).** Static:
  AAAA-map lookup handlers; SET overwrites the whole
  record. Live: [13,6]+admin → EMPTY success (no
  record — a miss is empty, NOT unknown-id);
  [13,7]+ws19-u → {3:u8 42, 1:"ws19-u",
  2:"hello-prefs"}; SET [13,7] → empty ack;
  GET-after-SET round-trips ("hello-prefs"). The
  ws19-u record SURVIVES user-delete + reboot
  (orphan-by-design: AAAA-keyed, no FK — the
  transcript is post-state). Which of 6/7 is
  WinBox vs WebFig stays open (n=1 user; 6 empty,
  7 populated).
- **[13,1/2/3/4,8] user-list path MAPPED
  (GETALL).** [13,1] = /user (1 row: admin, group
  3, "system default user"); [13,2] = /user/group
  (read/write/full + policy masks f2/f3);
  [13,3] = 17-row policy catalog
  (local/telnet/ssh/ftp/reboot/read/write/
  policy/test/winbox/password/web/sniff/
  sensitive/api/romon/rest-api; ids 1–16+19, gap
  at 17–18; f3 = access-class (1 for
  local/telnet/ssh/winbox/web/api/rest-api));
  [13,4] = active sessions (3 admin rows: f1/f3
  u32 stamps, f4 transport 13/9/1, f6=2/f8=3
  const) — DUAL-ROLE with source-id adoption
  (GET adopts + GETALL lists on the SAME handler;
  closes the schema open question); [13,8] =
  single default row ({id 0, 0xfe0010
  "default"}).
- **Routerboard REST gate WITNESSED (both
  versions; CLI-gate, no transcript).**
  /system/routerboard is ABSENT on CHR/x86 both
  versions: v7 = validation/menu-unavailable
  (build-gated !i386); v6 = :parse-reject (no
  such path). v7 /system/resource carries NO
  routerboard field (board-name is the QEMU
  string). The prior "v6 returns routerboard:false"
  note was not reproduced and is dropped (likely a
  [24,17]/resource-shape confusion).
- **0xff001e hunt NEGATIVE (6 exotic rows).**
  macvlan/pppoe/vxlan/wg + ether1/lo: no
  0xff001e in any row (static-only still).
  Bonus: PPPoE rows have NO f5 actual-name (no
  kernel device — VRRP-class).
- **f2 re-confirmed (270947 both versions).**
  ws19 ether1/ether2 f2 = 270947 (0x42263)
  identically — no version flip; bit meanings
  stay background.
- **0x98 tcode (bytes16_array) added.** PPPoE
  rows decode as count-u16le + 16B items
  (`m2.ts` + `physical/nv-message.yaml`;
  alignment-clean).
- **§18-CONFAB RETRACTION.** A compacted
  summary's "#1–#8 / A/B/C / 14/14" iteration
  details were UNSAVED reconstructions, partly
  wrong. Ground truth from transcripts: T1
  bridge del/add keeps slot (iter1=iter2); T2
  ws18-br→aabr pos2→pos1 (crossed lo, stopped
  before ether1); T3 ether1→a-ether pos0
  (no-left, non-discriminating); T4
  a-ether→zz-ether pos0 (FROZE despite
  crossed-right aabr — pos0-immobile); T5
  aabr→bridge pos1 (old < left → noncross
  freeze); T6 ether2→a-eth2 pos1→pos0
  (DISPLACED ether1); T7 ether1→zz-e1 pos1
  (new > left → noncross freeze); T8a
  a-eth2→ether2 pos0 (freeze); T8b
  zz-e1→ether1 pos1→pos0 (displaced).
  A/B/C NEVER HAPPENED (ws19 booted pristine
  [ether1,ether2,lo] — no b-lo/y-e1/0-e1
  residue). Everything below is
  transcript-backed.
- **Iteration DUAL-MODE RULE (R1–R4; ~43
  transitions, ALL fit).** Rename X (old O,
  new N):
  - R1 GATE (universal, both modes, both
    directions): X swaps past adjacent N ⟺ N
    is strictly between O and N (left-neighbor
    L crossed ⟺ O>L>N; right-neighbor R
    crossed ⟺ O<R<N). Noncrossed ⟹ freeze
    (T5/T7/(i)-stop/w3/G1 — G1 is the
    rightward-gate proof: noncross-right
    froze despite sorted-pos 1 slot away).
  - R2 1NIC-MODE (day-0 1-NIC: twin3 ×25 +
    twin4-fresh ×1, incl. pre-reset T2):
    pos0-slot FROZEN (occupant immobile (T4)
    and unenterable (T6b/dec/dec2/H15/T-A));
    leftward = crossed-bubble stopping at
    pos1 (one-short: T2/T9/D6/D2a/D3/
    (iii′)/(vii)); rightward = full
    crossed-run (D1/D2b/(ii′)/(vi)/(viii));
    creation = sorted-insert (incl. pos0);
    reboot persists order AND mode;
    invariant: sorted-except-possibly-(0,1)
    (13/13 deep snaps).
  - R3 2NIC+-MODE (day-0 2/3-NIC: ws19 ×14
    plus ws20-fresh ×2 + ws21-fresh ×1): MOVE ⟺
    crossed-run == 1 (exactly one crossed
    neighbor ⟹ single adjacent swap;
    run-0/run≥2 ⟹ freeze — p2, p2-replica,
    w1 = 3/3 run-2 freezes; 8/8 run-1
    moves). NO pos0-specialness (6/6
    pos1-entries T6/T8b/T6r/H14/T-D/H26b +
    (F1b) pos0-exit rightward).
  - R4 MODE ⟺ DAY-0 NIC COUNT (1 ⟹ R2;
    ≥2 ⟹ R3): fresh-box 4-way — twin4-F +
    ws19-day0-M + ws20-M + ws21-M.
    Confounded triple (NIC-count ⟺
    boot-row-count ⟺ add-flags), documented
    as compound. twin4 shipped a 7.26b3
    image (version-confound neutralized:
    twin3-7.25-T2 was already restrictive
    pre-reset; bonus: 7.26b3-1NIC is R2
    too).
  - Killed, each by a named test:
    crossing-while-unbounded (a-z stopped
    pos1); max-1-swap (T9/D6/D3 moved 2);
    head-pinned (T6/T-D entries, (F1b)
    exit); full-sort (T2/T5/T6b); symmetric
    bound ((ii′) full-rightward);
    stale-tree-keys (T7); mover-type gate
    H1 (decisive: physical lo froze);
    delete+add-procedure H6 (T6r documented
    `set` moved); vlan-presence H13 (dec2
    no-vlan froze); letter-gate H15
    (splitter: letter-new froze on twin3);
    composition H14 (H14-test moved with
    vlan); current-sort-order H23 (T-A:
    sorted twin3 froze; T6b sorted froze);
    inversion-history H21 (T2 restrictive
    with zero prior inversions);
    delete-history H26 (H26b moved after a
    delete); reset-cause H22 (T2 pre-reset
    restrictive + T6 fresh permissive);
    VRF-scar H30 (T2 pre-incident);
    id/ifindex/flags H27 (2nic5 rows match
    twin3 exactly); twin3-quirk H31
    (twin4 froze); ws19-quirk H33 (ws20/ws21
    moved). Pos0-"stickiness" refined away:
    every twin3-pos0-freeze was
    noncross/vacuous except T4 (the genuine
    R2 guard); (F1b) proves pos0 exits when
    crossed (R3).
  - Weaknesses: ws19 run≥3 untested ((F2)
    redesigned to run-1 by the (F1b) move);
    v6 iteration not yet probed (no [20,0]-rename
    series on ws3c6); MECHANISM open
    (static: rename-fixup branch keyed on
    day-0-NIC-persistent state — tree
    birth-shape? lo depth? phys-count
    field? needs Ghidra, not objdump).
- **Lab notes.** twin4 PRE-EXISTED dirty
  (dockers-bridge + veth1 residue) → cleaned
  to a fresh 7.26b3 image; ws20/ws21 NEW
  (kept stopped — permissive specimens);
  twin1 was RUNNING (not mine, untouched)
  then stopped WITHOUT me (observed after;
  cause unknown); twin3-DHCP lesson (centrs
  retrieve wants REST paths — '/ip/address'
  shows the dynamic lease, '/ip/address/print'
  showed static-only/empty); all MY boxes
  stopped with baselines re-verified (twin3
  2 interfaces / 1 addr / 0 mangle / 1 user;
  ws19 3 interfaces; ws20 3; ws21 4; twin4 2).

Still open (updated): pid-1025 identity,
routerboard full shape (menu-absent both
versions — homeless), [24,10/33/35] +
107/122/125 + 114/115/126-family + 134 roles,
[20,61] (modem_aux, selector unknown),
[13,6/7] WinBox/WebFig split, terminal
surface, nlevel proof (likely untractable),
0xff001e sighting, 0x10002 low-byte flag
meanings, ITERATION-MECHANISM (static
fixup-branch) + v6-iteration + ws19-run≥3.
CLOSED this batch: iteration BEHAVIOR
(dual-mode R1–R4), user-list path,
[13,4]-duality, UserPrefs identity +
semantics, routerboard gate, 0x98 tcode.
