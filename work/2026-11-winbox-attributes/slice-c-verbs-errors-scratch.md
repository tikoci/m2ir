# Slice C scratch: action/verb + error/status handlers (2026-11-01)

Scope: WinBox TLV/verb candidates for action verbs, error/status reply shapes.
Read-only research; no canonical YAML promotion.

## Verb dispatch (grounded, v6 static)

Source: `work/2026-10-chr-extraction/net-bridge2-handler-tables.md` §1
(`nv::Handler::handleCmd` @0x28508, 6.49.23), mirrored in
`profiles/winbox-ipc/std-commands.yaml`.

| Verb | Slot | Live status (6.49.23/7.25 CHR) |
|---|---|---|
| GET/SET/GETALL/GETOBJ/SETOBJ/ADDOBJ/REMOVEOBJ | 9/10/14/12/13/15/16 | probed live, grounded |
| MOVEOBJ 0xfe0007 | 17 | NEVER sent live |
| GETCOUNT 0xfe0015 | 18 (net-0 local 0x805bcec → u32 0xfe0014, honors GETALL filters) | NEVER sent live; best grounded-verb candidate |
| RESET 0xfe0016 | 11 | NEVER sent live |
| SETFORM/NOTIFY/START/POLL/CANCEL (0x08/0x0b/0x0f/0x10/0x11) | DEFAULT → slot 19 | NEVER sent live |
| SUBSCRIBE/UNSUBSCRIBE (0x12/0x13) | non-virtual direct | NEVER sent live |
| SHUTDOWN 0xfe000c | 20 | NEVER sent live; DO NOT probe on shared infra blindly |
| DISCONNECTED 0xfe0014 | 24 (v6; v7 case 0x14 → slot 29) | observed as mproxy retry-notify, never sent |
| GETPOLICIES 0xfe0001 | DEFAULT → slot 19 | NEVER sent live |
| NOOP 0xfe0000 | empty reply | NEVER sent live |
| slot-19 private (small ints, 0x100xx, 0x60001/0x70001) | 19 (v6) / 24 (v7 [20,0] local switch) | partial: [20,61] pre-filter claims 0xfe000f/0xfe0011 + priv 5/6/7 + 0x3e8-0x404 (static only) |

v7 drift: vtable shifts past slot 12 (13=cmdGetObj-overload … 17=cmdStopGetAll …);
v7 libumsg DEFAULT routing NOT decoded (open).

## Action fields (TLV candidates)

- NAT [20,5] field 40 `action` u32 + RAW [20,87] field 40 `action` u32
  (`gui-handlers.yaml:1142,1174`): names only, value enum UNDECODED.
  Next: correlate REST `action=` strings (accept/drop/jump/…) against M2 u32
  across a rule matrix; read-back discriminates.
- NAT f30/f33/f137 mark feeders + socksify trio u3f3/u3f4/u3f5 (M2-only):
  adjacent action surface, same experiment.

## Error/status (grounded)

- Envelope: SYS_STATUS 0xff0004 (1=OK, 2=ERROR) + SYS_ERRNO 0xff0008;
  `sys-keys.yaml:77-90,118-125`; `std-errors.yaml:42-56`.
- Base rules (static): cmdGet/cmdSet/cmdGetAll/cmdUnknown → NOTIMP 0xfe0003;
  missing obj-id → UNKNOWNID 0xfe0004.
- Live-sighted errnos: BRKPATH, NOTIMP, UNKNOWNID, FAILED, EXISTS.
  Never sighted live: UNKNOWN, MISSING, NOTALLOWED, TOOBIG, UNKNOWNNEXTID,
  BUSY, TIMEOUT, TOOMUCH.
- SYS_ERRSTR 0xff0009: ZERO sightings in any capture (`ev/`, proof/);
  correlate.ts:167 reads it, always null so far.
- statusWord ABSENT (not 1) on success: identity GET + SET acks
  (`correlate.ts:26-27`, smoke/proof logs). Consumers must treat
  absent≠error and must not treat ok-shape as proof (field-13 RO probe).
- 0xfe0019 total-count rides even UNKNOWNID error replies; absent on [20,0].
- Truly-unknown pids → SOCKET TIMEOUT (no reply), vs BRKPATH from=[pid]
  for existing pids (findings §17).
- Identity setter failure → errorMsg(0xfe0006) = ERROR_FAILED (static,
  `sys2-handler-tables.md:62`); no live trigger yet.

## Exact next capture/proof needed

1. GETCOUNT on [20,0] (both versions): expect u32 0xfe0014; compare with
   GETALL row count + 0xfe0019; filter-leg interaction.
2. RESET 0xfe0016 on a disposable [13,7]-style prefs record or throwaway
   singleton: does slot-11 reset-to-default exist anywhere? High risk;
   snapshot/destroy VM.
3. MOVEOBJ 0xfe0007 on firewall table with 2+ rules: row reorder?
   Needs row-id addressing like SETOBJ (0xfe0001).
4. SUBSCRIBE/START/POLL/CANCEL sequence on any list handler: notify flow?
   Match on SYS_REQID; expect async traffic (correlate.ts stash path).
5. Errstr hunt: force FAILED (identity setter failure?) / TOOBIG (huge
   ADDOBJ?) / MISSING / BUSY and capture 0xff0009 + statusWord presence.
6. NAT action enum: REST-driven rule matrix (each action= value) × M2
   GETALL f40 read-back; then inverse M2 SETOBJ f40 + REST read-back.
