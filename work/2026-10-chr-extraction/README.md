# WS-3A working notes — CHR offline extraction (7.25 + 6.49.23)

For the next configuration-field and native-verb phase, start with the
[attribute discovery execution plan](../2026-11-winbox-attributes/attribute-discovery-plan.md).
It reuses this directory's evidence and prober while adding controlled
experiments and schema validation. The historical sequence below records
the earlier extraction work; canonical YAML contains its corrected results.

Source images (quickchr cache, `~/.local/share/quickchr/cache/`):
`chr-7.25.img` (128M), `chr-6.49.23.img` (64M). Fully rootless chain:
`dd` → `debugfs` → carve → `~/.local/bin/unsquashfs` (4.7.5).

> Extracted trees live at `~/.local/share/m2ir/extractions/`
> (`root-7.25/`, `root-6.49.23/`, `dude-6.49.23/`), NOT under `work/`.
> The trees contain absolute symlinks (`var/tmp -> /tmp`) that send
> repo-wide tool traversal (`bun test`, `tsc`) into `/tmp` and OOM the
> run (proven: 9.7GB SIGABRT). Never extract trees under `work/`.
> Partition/image/squashfs intermediates stay in this dir (gitignored).

## Layout (both versions)

- `chr-7.25.img`: p1 32M boot, p2 94M ext3 `RouterOS` →
  `chr-7.25-part2.ext3`. System payload is `/var/pdb/system/image`
  (20.9M): 4KB NPK-style header (`system`, `Main package with most of
  services and drivers`) + squashfs at offset 4096 →
  `routeros-7.25.squashfs` → `~/.local/share/m2ir/extractions/root-7.25/`.
- `chr-6.49.23.img`: p1 64M ext3 at sector 1 → `chr-6.49.23-part1.ext3`.
  `/var/pdb/{routeros-x86,dude}/image` (21.0M / 1.5M), same 4KB header +
  squashfs@4096 shape. Base extracted to `.../extractions/root-6.49.23/`,
  dude package to `.../extractions/dude-6.49.23/`.

## Inventory

| version | nova/bin | .x3 files | userland |
|---|---|---|---|
| 7.25 | 80 ELFs | 15 (`nova/etc/<subsystem>/system.x3` + `bndl/*/…`) | 32-bit x86, `/lib/libc.so` |
| 6.49.23 | 79 ELFs | 37 (incl. `nova/etc/loader/*.x3`) | 32-bit x86, uClibc |

Note the version drift: v6 keeps per-package maps at
`nova/etc/loader/<pkg>.x3`; v7 uses `nova/etc/<subsystem>/system.x3`.
The old plan path `nova/etc/loader/system.x3` exists in NEITHER —
v6 has `loader/<pkg>.x3`, v7 has no `loader/` at all.

## `.x3` format (cracked open, decoder pending)

- All `.x3` start `[totlen:u32 = filesize-4]`. Two body layouts:
  - (a) **chunk chain** `[len:u32][payload]*` consuming exactly to EOF:
    `services`, `system_names`, `pciinfo` (v6 198KB/77 chunks).
    Chunks: pure strings (`"telnet"`), empty, `[u32s]+trailing-ASCII`
    (ports `"23"`, paths).
  - (b) **typed records** `[type:u32][0:u32][records]` (`radius` type
    208, `leds` type 114, + net-remote/user/www/ports/loader):
    radius record = 5×`(u32,u32)` + `"%d,%d"` echo of the last pair;
    per-record info is `(X∈{40,41,42}, A, B)`.
- The `leds/system.x3` 20B tags are inside layout (b), not hashes of files.
- **Reader**: `led` main calls `xml::Document::Document(path)` — `.x3`
  is an XML-derived binary serialization. Parser lives in
  `/lib/libuxml++.so` (13KB, exports `Document/Node/Attribute::…`,
  `Node::find(uint)`). `Document(span)` is a lazy wrapper (26B);
  real decode is in `Node::find`/`Attribute::get`.

## `.x3` grammar (EXACT, 52/52 strict-parse via `x3parse.ts`)

From libuxml++ `Node::find/size`, `AttributeList::find/size`,
`Attribute::get<T>/text`, `NodeIterator++`, `.rodata` esize `[1,1,4,4]`:

- `Node@p: [len][tag][attrlen][attrs:attrlen B][children]`;
  children `@p+12+attrlen`, end `@p+4+len`.
- AttrList header IS the node's attrlen slot (`this=p+8`);
  items step `len+4`.
- `Attribute@q: [len][id][etype][count][slen][values][text]`;
  total `20+esize[etype]*count+slen = len+4` (attrs may be UNALIGNED).
- Root tags: loader 33, starter 226, radius 208, services 53,
  net-remote 41, leds 114, pciinfo 45, ports 51, log-prefix 149,
  system_names 57, user 59, www 170.

## v6.49.23 process map (`process-map-6.49.23.json`, 91 entries)

From `nova/etc/loader/system.x3` + `bndl/*/loader/*.x3` + `dude.x3`:
record = `tag=30` node, attr 7 = path, attr 4 = process ID. Key
resolutions for `processes.yaml` (all version-scoped to 6.49.23):

- `0x10` = **bridge2** (16); dude = **103** → the dude-vs-bridge
  conflict resolves as version-scoped (bridge here; Cisco-Talos's
  `dude` label is another version).
- mepty = **76 (0x4c)**; process `0x0a` = **discover** (10) →
  `[76]` IS the loader-assigned mepty id; command top-byte `0x0a`
  vs path `0x4c` still unexplained (flag for WS-4).
- `0x14 interface` ⟺ **net** (20); `0x18 management` ⟺ **sys2** (24);
  `0x0d` = **user** (13, stable since 6.43.45); `0x02` = **mproxy**,
  moduler = 6; radv = 31, cerm = 19, `0x41 license` ⟺ keyman? (65);
  `[120]` 'login' ⟺ **quickset** (120) — conflicts with the
  session/login-handler claim, needs WS-4 note.
- Two pathless records (21: `56=[24,23]`, 71: `56=[20,50]`) adjacent
  to net=20/www=70 — SOLVED (ws3c-prober-findings.md §23): attr 56
  is a forward route, both live on v7 (bare [21]→from=[24,23],
  bare [71]→from=[20,50], pure TO-rewrite).
- 29 map entries have no on-disk binary (package NPKs not cached for
  v6: dhcp/hotspot/ppp/wireless/…; plus partd/msgfw/vm/cloudpingd).

## v7.25 process map — FOUND in libumsg (§38)

Superseded: the map was never in loader/x3 config. The v7 pid
registry is compiled into libumsg `handler_info` (PR table, 138
entries, pids 2-172, pid = `prog(binary-name)`; HD table, 296
menu/store bindings) — see `profiles/winbox-ipc/processes.yaml`
`handler-info-registry`. No static alias/shim table exists:
aliases/shims/stubs are boot-atomic dynamic router state. Do not
assume v6 x3 IDs hold on v7 where the PR table disagrees (pid 61:
v6 rbbios, v7 ipsec-worker).

## Next (WS-3B/3C)

1. ~~`find_handlers`-style registration-table hunt~~ DONE —
   sys2: [`sys2-handler-tables.md`](./sys2-handler-tables.md)
   (17 IDs, [24,1]+[24,2] decoded, 14 new fields).
   Framework + net/bridge2:
   [`net-bridge2-handler-tables.md`](./net-bridge2-handler-tables.md)
   (dispatch, slots, namespaces, 5 handler tables, tools
   `handlers.ts`/`fields.ts`). Routerboard owner hunt:
   [`routerboard-hunt.md`](./routerboard-hunt.md) (tool `rbscan.ts`;
   149 ELFs × 2 versions, no RB row-shape; `[24,17]` sys-to
   suspect, keyman license-shaped builder version-drifted).
   Server-side crypto grounding DONE:
   [`ucrypto-grounding.md`](./ucrypto-grounding.md) (EC-SRP5 +
   session crypto fully grounded on both versions, v7
   wire-identical; 5 corrections queued for WS-4).
2. ~~WS-3C TS/Bun wire prober vs quickchr~~ DONE —
   [`ws3c-prober-findings.md`](./ws3c-prober-findings.md) (prober
   `ws3c/probe.ts` + 40 evidence transcripts in `ws3c/ev/`; 900+
   sessions vs 7.25 + 6.49.23: minimal-length encodings proven,
   be32 + session bools confirmed, handler maps live both versions,
   `[24,17]` BRKPATH both, license {12,13} both, v6/v7 salt
   lifecycle split; 19 more corrections queued for WS-4).
   Remaining: routerboard M2 location, unknown singletons §10,
   GETOBJ/terminal surfaces (see findings §13). The [20,0]
   start-cursor static decode is DONE post-WS-4 (no slot-14 override
   exists — slot-7 handleCmd dispatch, lower_bound start; see
   net-bridge2-handler-tables.md §8).
3. ~~WS-4 schema drain~~ DONE — all §7(a–e) + §12(f–s) corrections
   plus the sys2/net-bridge2 first-party catalogs drained into
   `profiles/winbox-ipc/` (10 files) + `physical/nv-message.yaml`:
   crypto fixes (client-first j, minimal-length proof, no inner
   0x06, salt lifecycle, MSCHAP scoping, MAC enforcement),
   CMD_SHUTDOWN + dispatch model, GETALL paging semantics, 14 new
   resource fields, 12 new/raw handlers, v6 process-map
   resolutions, be32/NS-1/session-naming corrections. One triage:
   STATUS_OK rename DECLINED (see sys-keys.yaml trail).

Large regenerable files in this dir (`*.ext3`, `*.image`, `*.squashfs`,
`root-*/`) are build artifacts, not evidence — see `.gitignore`.
