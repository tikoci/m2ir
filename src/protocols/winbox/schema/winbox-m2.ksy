meta:
  id: winbox_m2
  title: WinBox "M2" / nv::message TLV format
  file-extension: m2
  endian: le
  license: CC0-1.0
  ks-version: "0.10"

doc: |
  Decoded WinBox application messages. After the chunked transport layer
  (see `winbox_chunk.ksy`) is reassembled and (for tag 0x06) AES-decrypted,
  the result is an `m2_message`: the literal ASCII bytes "M2" followed by
  zero or more TLV entries until end-of-stream.

  Within RouterOS source / leaks this is the `nv::message` binary form
  (the textual form is deprecated and not covered here).

  TLV entry layout
  ----------------
  Every entry begins with a 32-bit little-endian "type word":
    [bits  0.. 7] key_low      (low byte of 24-bit key id)
    [bits  8..15] key_high     (mid byte of 24-bit key id)
    [bits 16..23] namespace    (high byte of 24-bit key id)
    [bits 24..31] type_class + size_flag

  The high byte itself decomposes as:
    bit 24 (mask 0x01) = "compact" flag — if set, lengths/values use 1 byte;
                          if clear, they use the wider (4-byte int / 2-byte
                          length) form.
    bits 25..31 (mask 0xF8 in the high byte; or 0xF8000000 over the word) =
                          type-class.

  Per-class semantics — followed by ↓ payload:
    0x00  bool       no payload; the value is carried in the size_flag bit
                     itself: 0x01000000 -> true, 0x00000000 -> false.
    0x08  u32        size_flag set -> 1-byte value; clear -> 4-byte LE value.
    0x10  u64        always 8-byte LE value (no size_flag variant defined).
    0x18  ip6_addr   16-byte IPv6 address (NOT a signed integer — surprise).
    0x20  string     length-prefixed UTF-8; size_flag selects 1- or 2-byte len.
    0x28  message    length-prefixed nested M2 message (recursive).
    0x30  raw        length-prefixed opaque bytes.
    0x80  bool_array (FORWARD-DECLARED IN ROUTEROS BUT NEVER REGISTERED;
                     no observed traffic).
    0x88  u32_array  2-byte LE count, then count u32 LE values.
    0x90  u64_array  (FORWARD-DECLARED IN ROUTEROS BUT NEVER REGISTERED;
                     observed in samples per public sources, never wired up).
    0xA0  string_array  2-byte LE count, then `count` length-prefixed strings.
    0xA8  message_array 2-byte LE count, then `count` length-prefixed messages.

  This .ksy parses what the Cisco-Talos dissector parses. 0x80 and 0x90 are
  **declared but unparsed** here so they remain visible if they ever appear.

doc-ref:
  - https://github.com/Cisco-Talos/Winbox_Protocol_Dissector
  - https://margin.re/2022/06/pulling-mikrotik-into-the-limelight/

seq:
  - id: magic
    contents: "M2"
    doc: |
      Both root and nested messages begin with this. Documented as the literal
      magic that distinguishes nv::message binary form from the deprecated
      pseudo-JSON form.
  - id: entries
    type: tlv_entry
    repeat: eos

types:

  tlv_entry:
    seq:
      - id: key_low
        type: u1
      - id: key_high
        type: u1
      - id: namespace
        type: u1
        enum: namespace
        doc: |
          0xFF system, 0xFE session/standard, 0x00 user. RouterOS uses this
          byte to dispatch the key_id into one of three namespaces; full-key
          lookup is `(namespace<<16) | (key_high<<8) | key_low`.
      - id: type_byte
        type: u1
        doc: |
          Decomposed: bit 0 (0x01) = compact flag, bits 3..7 = type-class.
      - id: value
        type:
          switch-on: type_byte
          cases:
            # bool — value lives in the type byte itself
            0x00: bool_value(false)
            0x01: bool_value(true)
            # u32 family
            0x09: u32_compact     # 1-byte value
            0x08: u32_wide        # 4-byte LE value
            # u64
            0x10: u64_wide
            # IPv6 (the surprise)
            0x18: ip6
            # strings
            0x21: string_short
            0x20: string_long
            # nested messages
            0x29: msg_short
            0x28: msg_long
            # raw bytes
            0x31: raw_short
            0x30: raw_long
            # arrays
            0x88: u32_array
            0xa0: string_array
            0xa8: msg_array
            # declared-but-unhandled (parse none, leave for inspection)
            0x80: unknown_array_class   # bool array — never registered
            0x90: unknown_array_class   # u64 array  — never registered
    instances:
      key_id:
        value: key_low | (key_high << 8)
        doc: 16-bit key index inside the chosen namespace.
      full_key:
        value: (namespace.to_i << 16) | (key_high << 8) | key_low
        doc: Canonical 24-bit "type ID" used in cross-tool tables.

  # Boolean — the value is encoded entirely in the type byte; this carrier is
  # parametric so we can emit a typed `value` field without consuming bytes.
  bool_value:
    params:
      - id: v
        type: bool
    instances:
      value:
        value: v

  u32_compact:
    seq:
      - id: value
        type: u1

  u32_wide:
    seq:
      - id: value
        type: u4le

  u64_wide:
    seq:
      - id: value
        type: u8le

  ip6:
    seq:
      - id: addr
        size: 16
        doc: 16 raw bytes; semantics = IPv6 address.

  string_short:
    seq:
      - id: len
        type: u1
      - id: value
        type: str
        size: len
        encoding: UTF-8

  string_long:
    seq:
      - id: len
        type: u2le
      - id: value
        type: str
        size: len
        encoding: UTF-8

  raw_short:
    seq:
      - id: len
        type: u1
      - id: value
        size: len

  raw_long:
    seq:
      - id: len
        type: u2le
      - id: value
        size: len

  msg_short:
    seq:
      - id: len
        type: u1
      - id: value
        size: len
        type: nested_m2

  msg_long:
    seq:
      - id: len
        type: u2le
      - id: value
        size: len
        type: nested_m2

  nested_m2:
    seq:
      - id: magic
        contents: "M2"
      - id: entries
        type: tlv_entry
        repeat: eos

  u32_array:
    seq:
      - id: count
        type: u2le
      - id: values
        type: u4le
        repeat: expr
        repeat-expr: count

  string_array:
    seq:
      - id: count
        type: u2le
      - id: values
        type: string_long
        repeat: expr
        repeat-expr: count

  msg_array:
    seq:
      - id: count
        type: u2le
      - id: values
        type: msg_long
        repeat: expr
        repeat-expr: count

  unknown_array_class:
    doc: |
      Type classes 0x80 (bool_array) and 0x90 (u64_array) are forward-declared
      in RouterOS but never registered in the dispatch table per Cisco-Talos
      source review. Encountering one in real traffic stops the parse — flag
      and capture for analysis rather than silently advancing.

enums:

  # ── 24-bit key namespaces ────────────────────────────────────────────────
  namespace:
    0x00: user        # application/per-handler keys
    0xfe: standard    # STD_* (object/session machinery)
    0xff: system      # SYS_* (transport/routing/auth)

  # ── SYS_* / STD_* canonical key IDs (Cisco-Talos dissector) ──────────────
  # Use the *full key* (`full_key` instance) to look up these names.
  # Note: this project's PROTOCOL.md has divergent names — see schema/README.md.
  full_key_id:
    # 0xFF0000 SYS_*
    0xff0001: sys_to
    0xff0002: sys_from
    0xff0003: sys_type           # values: 1=REQUEST, 2=REPLY
    0xff0004: sys_status         # values: 1=OK, 2=ERROR
    0xff0005: sys_replyexp       # bool — "reply expected" (this project calls this SYS_REQUEST)
    0xff0006: sys_reqid
    0xff0007: sys_cmd
    0xff0008: sys_errno          # this project mislabels this as SYS_STATUS
    0xff0009: sys_errstr
    0xff000a: sys_user
    0xff000b: sys_policy
    0xff000d: sys_ctrl
    0xff000f: sys_ctrl_arg
    0xff0010: sys_user_id
    0xff0011: sys_notifycmd
    0xff0012: sys_originator
    0xff0013: sys_raddr6
    0xff0016: sys_dreason
    # 0xFE0000 STD_*
    0xfe0001: std_id
    0xfe0002: std_objs
    0xfe0003: std_getallid
    0xfe0004: std_getallno
    0xfe0005: std_nextid
    0xfe0006: std_undoid
    0xfe0007: std_dynamic
    0xfe0008: std_inactive
    0xfe0009: std_descr
    0xfe000a: std_disabled
    0xfe000b: std_finished
    0xfe000c: std_filter
    0xfe000d: std_preset
    0xfe000e: std_pageno
    0xfe000f: std_page
    0xfe0010: std_name
    0xfe0011: std_interval
    0xfe0012: std_version
    0xfe0013: std_dead
    0xfe0014: std_count
    0xfe0015: std_getall_cookie
    0xfe0016: std_query
    0xfe0017: std_query_op
    0xfe0018: std_maxobjs
    0xfe0019: std_obj_count
    0xfe001a: std_class
    0xfe001b: std_snmp_query

  # ── Standard command codes (when SYS_CMD < 0x80000) ─────────────────────
  std_cmd:
    0xfe0000: cmd_noop
    0xfe0001: cmd_getpolicies
    0xfe0002: cmd_getobj
    0xfe0003: cmd_setobj
    0xfe0004: cmd_getall
    0xfe0005: cmd_addobj
    0xfe0006: cmd_removeobj
    0xfe0007: cmd_moveobj
    0xfe0008: cmd_setform
    0xfe000b: cmd_notify
    0xfe000d: cmd_get
    0xfe000e: cmd_set
    0xfe000f: cmd_start
    0xfe0010: cmd_poll
    0xfe0011: cmd_cancel
    0xfe0012: cmd_subscribe
    0xfe0013: cmd_unsubscribe
    0xfe0014: cmd_disconnected
    0xfe0015: cmd_getcount
    0xfe0016: cmd_reset

  # ── Standard error codes (when in SYS_ERRNO) ────────────────────────────
  std_errno:
    0xfe0001: error_unknown
    0xfe0002: error_brkpath
    0xfe0003: error_notimp
    0xfe0004: error_unknownid
    0xfe0005: error_missing
    0xfe0006: error_failed
    0xfe0007: error_exists
    0xfe0009: error_notallowed
    0xfe000a: error_toobig
    0xfe000b: error_unknownnextid
    0xfe000c: error_busy
    0xfe000d: error_timeout
    0xfe000e: error_toomuch

  # ── Process / handler 16-bit IDs (the high 16 bits of `nv::Handler` paths)
  # Values from Cisco-Talos `typeIDCode` "if no SYS/STD match, & 0xFF0000".
  # These are RouterOS *process* identifiers — the first element of SYS_TO/SYS_FROM.
  process_id:
    0x01: net
    0x02: moduler
    0x03: sermgr
    0x04: notify
    0x05: radv
    0x06: system
    0x07: ping
    0x08: undo
    0x09: log
    0x0a: mepty           # the terminal proxy used by this project (cmd 0x0A0065/0x0A0067)
    0x0b: pppman
    0x0c: radius
    0x0d: hotplug
    0x0e: bridge
    0x0f: diskd
    0x10: dude
    0x11: console
    0x12: cerm
    0x2c: route
    0xfd: local
    0xfe: standard_ns
    0xff: system_ns
