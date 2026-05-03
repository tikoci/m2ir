meta:
  id: winbox_chunk
  title: WinBox transport-layer chunked framing (TCP/8291)
  endian: be
  license: CC0-1.0
  ks-version: "0.10"

doc: |
  WinBox carries application-level payloads (either an M2 message in plaintext,
  or an AES-128-CBC encrypted blob containing an M2 message) over TCP port 8291
  using a simple chunked frame.

  The wire bytes are a sequence of chunks. Each chunk has a 1-byte length, a
  1-byte tag, and `length` payload bytes. A chunk with `length == 0xFF` carries
  255 payload bytes and signals "more chunks follow"; any chunk with
  `length < 0xFF` is the last chunk of the current message.

  Concatenating the payloads of all chunks of one message yields the assembled
  payload, which is either:
    * tag 0x06 (encrypted): [enc_length: u2be][iv: 16][ciphertext]
    * tag 0x01 (plaintext): [body_length: u2be][m2 message]

  Tags
  ----
  The first chunk's tag indicates the protocol mode: 0x06 = encrypted (EC-SRP5),
  0x01 = plaintext (legacy MD5 auth). Continuation chunks always carry tag 0xFF.

  These three tag values are observed-as-constant in MarginResearch wire dumps
  and the Cisco-Talos Wireshark dissector; **no public source names them**. We
  treat them as transport-layer constants distinct from M2's own type bytes.

doc-ref:
  - https://github.com/Cisco-Talos/Winbox_Protocol_Dissector
  - https://github.com/MarginResearch/mikrotik_authentication

seq:
  - id: chunks
    type: chunk
    repeat: until
    repeat-until: _.is_last

types:
  chunk:
    seq:
      - id: len
        type: u1
        doc: Payload byte count. 0xFF means "full chunk, more follow".
      - id: tag
        type: u1
        enum: chunk_tag
        doc: |
          0x06 / 0x01 on the first chunk of a message; 0xFF on continuation.
          Not observed to be used for any other purpose.
      - id: payload
        size: len
    instances:
      is_last:
        value: len < 0xFF

enums:
  chunk_tag:
    0x01: plaintext_m2     # observed-as-constant; not formally named in any public source
    0x06: encrypted_m2     # observed-as-constant; not formally named in any public source
    0xff: continuation     # observed-as-constant; not formally named in any public source
