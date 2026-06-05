# m2ir — strawman intermediate representation

_Imported from `subixonfire/winbox-terminal-protocol/schema/README.md` and lightly adapted for this repository's initial bootstrap._

This directory is an experiment in **format design**: how much of the
MikroTik `nv::message` ("M2") protocol family can be captured in a
durable, programmatically-useful schema instead of slide decks, blog
posts, and reverse-engineered code? The shorthand for the IR is `m2ir`.

The parent project (`winbox-terminal-protocol`) implements one tiny slice
— the `mepty` terminal handler over WinBox/8291 — and that slice is the
seed strawman. The same wire format also backs The Dude's on-disk objects
(see [`tikoci/donny`](https://github.com/tikoci/donny)), RouterOS-internal
IPC, the suspected RoMON tunneling, and more. The IR's job is to support
*all* of those in one place.

For the format-design discussion (what the strawman gets right, what it
gets wrong, what holes donny / centrs / mndp poke, the proposed target
shape, the imagined .h-file output, the cross-profile concept catalog,
and the file-split layout), read [`m2ir-design-review.md`](./m2ir-design-review.md). For the
deepest open problem — *contextual fields*, where one field's meaning
depends on a sibling field's value — read
[`m2ir-context-discrimination.md`](./m2ir-context-discrimination.md), which proposes a single
discriminator mechanism that covers all four discrimination patterns
seen so far. The rest of this README documents the strawman files as
they stand, so a reader can see the materials before the redesign.

## Files

| File | Purpose | Format |
|------|---------|--------|
| `profiles/winbox-ipc/strawman/winbox-chunk.ksy` | Outer chunked transport framing on TCP/8291 | [Kaitai Struct](https://kaitai.io) |
| `profiles/winbox-ipc/strawman/winbox-m2.ksy` | The M2 / `nv::message` TLV format itself, with type, key, command, and process-id enums | Kaitai Struct |
| `profiles/winbox-ipc/strawman/winbox-ec-srp5.ksy` | Pre-encryption EC-SRP5 handshake messages (4 shapes) | Kaitai Struct |
| `profiles/winbox-ipc/strawman/winbox-m2-semantics.yaml` | **Semantic overlay** — names, evidence, confidence, "apparent magics". Not Kaitai. | custom YAML |

The three `.ksy` files are valid Kaitai Struct schemas (`ks-version: 0.10`)
and can be compiled with `kaitai-struct-compiler` to produce parsers in any
target language (Python, Go, Rust, JS, C++, …). The semantic overlay is the
project's own invention — it's the metadata Kaitai can't represent.

## What Kaitai handles well here

- **Bit-level structure**: every observed type byte (`0x00..0xA8`), the
  compact-flag bit (`0x01000000`), the 24-bit key encoding, length prefixes
  (1-byte vs 2-byte LE), the `M2` magic. All of this is straightforward.
- **Endianness on every field**, explicit. Because Kaitai forces you to
  pick `u4le` vs `u4be` per field, the schema is self-documenting about
  which integers are LE and which are BE — a real win for a protocol that
  mixes both (M2 internals are LE; the chunk-frame `enc_length` is BE; the
  EC-SRP5 EC point coordinates are BE).
- **Recursion**: nested M2 messages (type `0x28` / `0x29`) parse via the
  same `tlv_entry` type. The ASCII `M2` magic is re-validated inside.
- **Enums for known constants**: `SYS_*`, `STD_*`, `CMD_*`, `ERROR_*`, and
  the process-ID table all become first-class enum values, so a generated
  parser produces e.g. `entry.namespace == namespace::system` and
  `command == std_cmd::cmd_getobj` rather than raw hex.

## What Kaitai *cannot* handle, and how this strawman copes

### 1. Same byte ID, multiple meanings depending on context

`SYS_CMD` (`0xFF0007`) can be either a `u8` (compact `0x09`, used pre-mepty
for `cmdGet=7`, `cmdOpen=5`, etc.) **or** a `u32` (`0x08`, used for
`meptyLogin=0x0A0065`). The Kaitai schema parses both correctly because the
type byte tells it which to expect — but it cannot express that the
*resulting integer* should be looked up in different name tables depending
on whether it falls in the `0xFE0000-` STD_CMD range or the
`(process_id<<16)`+`offset` handler-private range. We capture this in
`winbox_m2_semantics.yaml` instead.

### 2. Confidence and evidence per field

Kaitai treats every field as fact. But our knowledge isn't uniform:

- The TLV type bytes are **documented** (Cisco-Talos Wireshark dissector).
- The `0xFF0001..0xFF0016` SYS_* names are **documented**.
- The `0xFE0000..0xFE0016` STD_CMD names are **documented**.
- Most handler-private command codes (`0x0A0065` etc.) and most handler
  paths (`[76]`, `[24,0]`, `[120]`) are **observed-only** in this project's
  captures. No public source enumerates them.
- The chunk tags (`0x06`, `0x01`, `0xFF`) are **observed-as-constant** but
  not formally named in any public source. Whether they have semantic
  weight or are leftover transport magic is unknown.

The semantic overlay records `confidence: documented | inferred |
observed-only | guessed` for every named entity, plus `evidence` pointing
back to the source. Without this, future readers can't tell what's
load-bearing vs what's our best guess — which directly answers the user's
"buried understanding" concern.

### 3. "Magic bytes" that aren't really magic

Kaitai's `contents:` field validates a literal byte sequence ("magic"),
but it doesn't *flag* that a field is suspiciously constant when we don't
know why. For example, `key_8 = 0` in `meptyLogin` — every captured frame
has it, but we don't know if 0 is the only legal value, what the field
encodes, or even reliably whether it's a u8 or part of a wider field
(samples don't constrain endianness when all bytes are zero).

In the semantic overlay these are tagged `apparent-magic: true`:

```yaml
- context: "EC-SRP5 client_phase1 first byte"
  bytes: [0x06]
  confidence: observed-only
  notes: "Same value as the chunk tag; coincidence vs reuse unclear."
```

This makes the gaps *visible* rather than baked into a Python constant.

### 4. The "all samples are zero" endianness problem

You called this out specifically: if a 4-byte field is always `00 00 00 00`
in every capture, we know the *width* but not the *endianness*. Kaitai
forces a choice, and the schema looks confidently correct even though the
samples don't justify it.

Strawman fix: in the semantic overlay, fields can be tagged with an
`endianness-evidence` qualifier:

```yaml
endianness-evidence: from-spec      # MarginResearch / Cisco-Talos says LE
endianness-evidence: from-samples   # we saw a non-zero non-palindrome
endianness-evidence: unconstrained  # all observed bytes were 0x00
```

When `unconstrained`, a future contributor knows to look harder. The
`.ksy` still has to commit to a value; the overlay records *why*.

### 5. Same field, divergent names across sources

This project's `PROTOCOL.md` calls `0xFF0008` "SYS_STATUS" and `0xFF0005`
"SYS_REQUEST". Cisco-Talos calls them `SYS_ERRNO` and `SYS_REPLYEXP`,
respectively, and uses `0xFF0004` for the actual `SYS_STATUS`. Both names
exist in the wild. The overlay records both with `aka:` cross-references
so we can adopt the canonical names without losing the trail back to the
project's own labels:

```yaml
0xff0008:
  name: SYS_ERRNO
  aka: [project-PROTOCOL.md "SYS_STATUS"]
```

### 6. Encryption layer

Kaitai cannot decrypt. The `winbox_chunk.ksy` schema yields a
length-prefixed blob `[enc_length: u2be][iv: 16][ciphertext]` for tag-0x06
chunks; the consumer must run AES-128-CBC + verify HMAC-SHA1 before feeding
the cleartext into `winbox_m2.ksy`. We document the layout but stop there.
In practice the parser pipeline looks like:

```
TCP bytes ─► winbox_chunk ─► [if tag=0x06: AES-CBC decrypt + HMAC verify]
                            └► winbox_m2  ─► tlv_entry tree
```

### 7. Handler-path ambiguity

`SYS_TO` is a `u32_array` whose first element should be a `process_id` (8-bit
range per the canonical table) but this project observes paths like `[76]`
(0x4C) and `[120]` (0x78) which don't match any `process_id`. Either:
(a) those captures actually start with a *handler id* under an implicit
process, (b) the process table is incomplete, or (c) some captures embed
the handler in element 0 and others put it in element 1. Without more
samples we can't disambiguate. This is recorded as a known gap rather than
guessed away.

## Proposed extensions / where to take this next

Treating this as a strawman, here's what would make the schema more
durable for the broader WinBox protocol:

1. **A canonical key/command registry**, kept as a structured YAML
   (per-key one entry, similar to a JSON Schema) so additions are reviewable
   diffs. The Cisco-Talos dissector's Lua tables would be the seed.
2. **Per-handler sub-schemas**: each `process_id` (mepty, mproxy, undo,
   dude, …) would have its own YAML enumerating the handlers it exposes,
   the commands each handler accepts, and the user-namespace keys those
   commands use. This project supplies the `mepty` slice.
3. **Sample-driven validation**: pcap (or sanitized hex dumps) per
   command, referenced from the registry. Anchor tests for the schema —
   "this byte sequence parses to this AST" — would catch regressions and
   document evidence simultaneously.
4. **Confidence/evidence as first-class metadata**, not freeform notes.
   Schema tools could surface "fields with `confidence: observed-only` and
   no `samples` reference" as a TODO list.
5. **Adopting Cisco-Talos canonical names** while preserving aliases for
   community / blog-post terminology, so cross-references don't break.
6. **A separate "transport profile" overlay** that records what's known
   about non-WinBox-app speakers (this Python project, `nv::message` over
   TLS, post-7.x changes, etc.), so version-specific quirks have a place
   to live without polluting the core schema.

A "v0.2" pass might split the single `winbox_m2_semantics.yaml` into
per-domain files (`keys.yaml`, `commands.yaml`, `processes.yaml`,
`apparent_magics.yaml`) and add a JSON Schema describing the overlay's own
shape — meta-schema for the meta-schema. That would make tooling
(linters, doc generators, code generators) tractable.

## Footprint

This schema covers, at varying confidence:

- **Documented**: M2 magic, all 12 active TLV type classes, compact-flag
  bit semantics, the SYS_*/STD_*/CMD_*/ERROR_* constant tables, the
  process-id table, the EC-SRP5 message shapes, the chunked frame layout,
  the HKDF magic strings.
- **Observed-only**: chunk tag values, the legacy MD5 short-form command
  codes (1, 4, 5, 7), `key_8 = 0` in meptyLogin, mepty handler ids
  (`[76]`, `[120]`, `[24,*]`), the `SYS_FROM[1]` source-id semantics,
  `key_2`/`key_3`/`key_5..key_11` in the user namespace under mepty.
- **Declared-but-unparsed**: type classes `0x80` (bool_array) and `0x90`
  (u64_array) are present in the parser dispatch as "unknown_array_class"
  so they'll surface visibly in any capture rather than corrupting the
  parse silently.
- **Out of scope**: post-decrypt verification (HMAC-SHA1), AES-CBC
  decryption itself, the WinBox GUI/`mproxy` handler set, the WinBox
  protocol's old pseudo-JSON `nv::message` text form.

## Compiling and using

Sanity-check the Kaitai files (no installation required if you have
[`ksy-online`](https://ide.kaitai.io/)):

```bash
# install once
brew install kaitai-struct-compiler

# generate a Python parser
ksc -t python schema/winbox_m2.ksy schema/winbox_chunk.ksy schema/winbox_ec_srp5.ksy
```

The generated `winbox_m2.py` exposes a `WinboxM2` class with `from_bytes()`
that returns the parsed tree. The semantic overlay is plain YAML — load
with `yaml.safe_load()` and use as a side-table during display.

## References

- [Cisco-Talos `Winbox_Protocol_Dissector`](https://github.com/Cisco-Talos/Winbox_Protocol_Dissector)
  — Wireshark Lua dissector. Most complete public source for type bytes,
  SYS_*/STD_* keys, CMD_*/ERROR_* codes, and the process-id table.
- [MarginResearch — *Pulling MikroTik into the Limelight*](https://margin.re/2022/06/pulling-mikrotik-into-the-limelight/)
  — architecture overview: 24-bit keys, `nv::Handler`, EC-SRP5 quirks,
  policy bitmasks.
- [MarginResearch/mikrotik_authentication](https://github.com/MarginResearch/mikrotik_authentication)
  — EC-SRP5 reference implementation; the source for `winbox_ec_srp5.ksy`.
- [Tenable — *Make It Rain with MikroTik* (Jacob Baines)](https://medium.com/tenable-techblog/make-it-rain-with-mikrotik-c90705459bc6)
  — the canonical write-up of handler-private command numbering and the
  `mproxy` handler #2 file-transfer abuse.
- This project's `PROTOCOL.md` — the source for the mepty terminal-session
  flow and the legacy MD5 auth path.

## License

CC0-1.0 for the schema files (we want maximum reuse and re-derivation).
