# Slice B scratch: attribute get/set + pagination/listing handlers (WinBox TLV/verb candidates)

Research-only. Do NOT promote to profiles/*.yaml from this note.

## Grounded reference points (do not re-prove)

- Singleton-attr SET path: CMD_SET 0xfe000e on [24,1] f12 (RW) / f13 (RO, silent-ignore
  with ok-shaped ack). Proof: work/2026-11-winbox-attributes/proof/7.25-identity/report.yaml;
  schema: profiles/winbox-ipc/gui-handlers.yaml:224-274,
  profiles/winbox-ipc/std-commands.yaml:109-122.
- Table-row SET path: slot-7 SETOBJ (0xfe0003) + 0xfe0001=rowid on [20,0]; [20,0] CMD_SET
  is base-NOTIMP. Schema: gui-handlers.yaml:472-480; std-commands.yaml:48-59.
- GETALL paging core: std-keys.yaml 0xfe0002 (rows), 0xfe0003 (cursor, per-handler),
  0xfe0004 (count, version-divided), 0xfe0019 (total, handler-specific);
  harness: work/2026-11-winbox-attributes/harness/paging.ts:1-120.

## Candidate mappings (strength)

### GET/SET family

1. [13,7] WebUserPrefs CMD_SET overwrites whole username-keyed record; GET-after-SET
   round-trips (STRONG-MEDIUM: gui-handlers.yaml:1300-1324, ev/7.25-setone-13-7-u.json
   bare-SYS ack, §29 static vtable 0x8059e08; lacks harness lossless capture).
2. [20,125] /tool/sms native CMD_SET of f07 receive-enabled (MEDIUM: control-plane map
   7/12 proven §30 + gui-handlers.yaml:856-895; M2 write path never attempted; confound:
   allowed-number-clear quirk).
3. [24,10] boot-flags CMD_SET expected negative (file-probe getter, slot-9 0x805719e;
   gui-handlers.yaml:921-946) — discriminating RO/negative control.
4. [20,61] SET=NOTIMP live + [24,31] slot10=base static (negatives, STRONG).

### Listing/pagination family

- **5.** [20,1] GETOBJ obj=rowid fetch-one-row (MEDIUM-LOW: analogy to [20,0] GETOBJ
  ev/7.25-getobj-20-0-2.json; never tried on [20,1]).
- **6.** CMD_GETCOUNT 0xfe0015 on [20,0] -> u32(0xfe0014), honors filters (static-STRONG:
  net-bridge2-handler-tables.md:171-176 + §8 "Slot-18 getcount honors the same
  filters"; live-ZERO: no ev fixture, no probe path).
- **7.** [20,1] USER extras 0x000006 (u32 0) + 0x00000b (bool F) in ev/7.25-getall-20-1.json
  (NEW, unmapped: absent from gui-handlers.yaml:539-552 and candidates.yaml ip/address
  fields; 0x06 may be vrf-row-id shaped — needs discrimination, not assertion).
- **8.** CMD_RESET 0xfe0016 expected base-NOTIMP (LOW: slot-11 mapping only,
  net-bridge2-handler-tables.md:43; no override found, no live probe).
- **9.** STD_QUERY 0xfe0016 + STD_QUERY_OP 0xfe0017 nested GETALL filter (documented-only,
   std-keys.yaml:302-312; never observed) and STD_FILTER 0xfe000c shape conflict
   (nested documented vs u32 observed, std-keys.yaml:210-233).

## Exact next captures (Phase C style, disposable CHR, harness JSONL + reqid)

- C1: native SET [20,125] {0x07:bool} toggle + GET read-back + independent REST
  /tool/sms read + restore; mirror prove-identity.ts 6-step incl. RO-probe control.
- C2: raw [20,0] CMD 0xfe0015 bare, then with 0x10001=1 filter; expect 0xfe0014 count;
  repeat 6.49.23 + 7.25; on success extend to [20,1].
- C3: GETOBJ [20,1] obj=1 (expect row) + obj=999 (expect UNKNOWNID).
- C4: [20,1] multi-page: count=1 chain over >=2 synthetic addresses; verify token chain,
  0xfe0019 total, no gaps/dups (paging.ts getAllPages).
- C5: CMD 0xfe0016 on [24,1] + [20,0]; record NOTIMP-or-otherwise with versions.
- C6: re-capture [13,7] SET+GET round-trip under harness (lossless JSONL, reqid
  correlation, whole-record-overwrite check).
- C7: [20,1] 0x06/0x0b discrimination: DHCP-created row vs static; bridge disable;
  VRF attach; diff rows field-for-field.
