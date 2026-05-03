meta:
  id: winbox_ec_srp5
  title: WinBox EC-SRP5 handshake messages (pre-encryption frames)
  endian: be
  license: CC0-1.0
  ks-version: "0.10"

doc: |
  The four messages that precede AES-128-CBC session traffic on RouterOS
  >= 6.43. Each message is wrapped in the same chunked frame as the rest
  of the protocol (see `winbox_chunk.ksy`) using tag `0x06`, so the byte
  layouts shown here are the *assembled* (post-dechunking) payloads.

  Endianness note: the elliptic-curve points are serialized big-endian in
  Curve25519/Weierstrass form (32 bytes), the parity flag is a single byte
  (0 = even Y, 1 = odd Y), and the salt is opaque 16 bytes.

  Every step is observed-as-constant; no length headers exist inside these
  payloads — message identity is positional / size-based.

doc-ref:
  - https://github.com/MarginResearch/mikrotik_authentication
  - https://margin.re/2022/06/pulling-mikrotik-into-the-limelight/

# This is a *family* of related shapes; consumers select which based on
# direction (client→server vs server→client) and phase (1=pubkey, 2=confirm).
# Kaitai can't dispatch on context alone, so we expose them as named types.

types:

  client_phase1:
    doc: Client → Server, phase 1 (public key offer with username).
    seq:
      - id: tag
        contents: [0x06]
        doc: Same `0x06` as the chunk tag — purely conventional, not validated.
      - id: username
        type: strz
        encoding: UTF-8
        doc: NUL-terminated UTF-8 username.
      - id: pubkey
        size: 32
        doc: Curve25519 client public point, big-endian X coordinate.
      - id: parity
        type: u1
        doc: Y-parity bit of the client public point (0 = even, 1 = odd).

  server_phase1:
    doc: Server → Client, phase 1 (public key + salt).
    seq:
      - id: tag
        contents: [0x06]
      - id: pubkey
        size: 32
        doc: Curve25519 server public point, big-endian X coordinate.
      - id: parity
        type: u1
      - id: salt
        size: 16
        doc: Per-user salt; treated as opaque bytes by the client.

  phase2_confirmation:
    doc: |
      Used in both directions for phase 2; structurally identical for client
      and server, only the derivation input differs.
    seq:
      - id: tag
        contents: [0x06]
      - id: confirmation
        size: 32
        doc: SHA-256(...) confirmation value.
