# profiles/winbox-ipc/

RouterOS IPC over TCP/8291 — the WinBox app's wire conversation with a
router. Same `nv::message` grammar as `dude-on-disk/` and `winbox-cdb/`;
this profile names byte 2 as `namespace` (0xFF=system, 0xFE=session,
0x00=user) and uses the low bit of the tcode to signal compact length.

## Layout

- [`profile.yaml`](profile.yaml) — top-level: namespaces, byte-2-as,
  compact rule, classification on SYS_CMD, refs to the sub-files below.
- [`transport.yaml`](transport.yaml) — TCP/8291 chunked framing
  (tags 0x01/0x06/0xFF) and the HKDF magic strings.
- [`ec-srp5-handshake.yaml`](ec-srp5-handshake.yaml) — four pre-encryption
  handshake messages.
- [`sys-keys.yaml`](sys-keys.yaml) — SYS_* keys (namespace 0xFF).
- [`std-keys.yaml`](std-keys.yaml) — STD_* keys (namespace 0xFE).
- [`std-commands.yaml`](std-commands.yaml) — STD_CMD_* values for SYS_CMD.
- [`std-errors.yaml`](std-errors.yaml) — STD_ERROR_* values for SYS_ERRNO.
- [`processes.yaml`](processes.yaml) — handler/process IDs.
- [`commands.yaml`](commands.yaml) — handler-private and legacy
  short-form SYS_CMD values.

The original Kaitai-style seed material (chunk frame, M2 TLV grammar,
EC-SRP5 handshake, semantic overlay) is preserved in [`strawman/`](strawman/)
as evidence — the canonical YAML files above are derived from it.
