# m2ir — design notes

_Imported from `~/Lab/winbox-terminal-protocol/schema/DESIGN.md` and lightly adapted for this repository's initial bootstrap._

`m2ir` is the working name for an intermediate representation of MikroTik's
binary protocol family. The wire format ("nv::message", informally "M2"
after its `4D 32` magic) is shared across many RouterOS surfaces:

- WinBox network IPC over TCP/8291 (this project's domain)
- The Dude's on-disk object store (`dude.db` `objs.obj` BLOBs — see
  [`~/GitHub/donny`](https://github.com/tikoci/donny))
- WinBox client's saved-connections file (CDB) — same wire format,
  different field semantics, optional RC4-encrypted variant. Reference
  impl: [`~/Lab/centrs`](../../) `src/data/winbox-cdb.ts`. RoMON targets
  show up here as `recordType=7/8` with a `romonAgent` field — i.e. the
  CDB profile is one of the few places RoMON has a public, parseable
  shape today.
- MNDP (UDP discovery) — *different* TLV grammar (BE u16 tag/length, no
  marker/tcode byte) but conveys *the same semantic values* (router
  identity, version, board model, MAC, IPv4/v6, uptime) that turn up
  again in the nv::message profiles. Reference impl:
  [`~/Lab/mcp-monorepo/mcp-mikrotik`](../../) `src/mndp.ts`. This is
  what makes a profile-independent **concept catalog** unavoidable.
- RouterOS-internal IPC (`/nova/bin/*` processes — partly known via Cisco-Talos / MarginResearch)
- mproxy file transfer, the undo handler, dude-server-to-router probes,
  potentially several more

Same byte grammar, very different *usage*. The point of m2ir is to capture
that knowledge once, durably, in a form humans and agents can read directly
and tooling can transform — so the next agent doesn't burn 100k tokens
re-reading MarginResearch to relearn what `SYS_CMD = 0xFF0007` means or
what tcode `0x18` carries.

This doc is honest design discussion, not a TODO list. The strawman in
this directory shows the materials; this doc is about whether the *shape*
holds up.

## What the strawman got right

The README.md framing is sound:

- **Bit-level grammar is small, stable, and well-described** — it's the
  byte layout of one TLV entry, plus the tcode → payload-rule table. That
  fits comfortably in Kaitai Struct or any equivalent.
- **Names + evidence + confidence belong in a separate sidecar** — Kaitai
  enums alone can't say "this name is from Cisco-Talos but this one is
  observed-only in our captures". The `winbox_m2_semantics.yaml` overlay
  was the right impulse.
- **Apparent-magic flag** for "constant bytes whose meaning we don't yet
  know" is the right idea. So is `aka:` for divergent naming across
  sources.

## What the strawman got wrong

Reviewing the strawman against `~/GitHub/donny`'s `DESIGN.md` and
`src/lib/nova.ts`, two structural mistakes surface:

### 1. Kaitai-as-primary, YAML-as-sidecar is upside down

The `.ksy` files are the smaller artifacts. The 11k YAML and the 11k
README are where the actual long-lived knowledge lives. But because the
`.ksy` is what compiles, it gets treated as canonical, and the sidecar
gets treated as commentary. That leaks: the SYS_*/STD_*/process-id enums
ended up baked into `winbox_m2.ksy`, which makes them feel authoritative
when they're really one *profile's* worth of names.

**Inversion:** the durable artifact should be the YAML. Kaitai is one of
several derivation targets (alongside JSON Schema, TypeScript types, a
human-readable HTML doc). When agents update m2ir from new evidence,
they edit the YAML; tooling regenerates the rest.

### 2. The IR is silently hardcoded to one profile (WinBox-IPC)

Donny shows the same wire format used completely differently:

| Concept | WinBox-IPC profile | Dude-on-disk profile |
|---|---|---|
| Byte 2 of TLV header | `namespace` (0xFF=system, 0xFE=session, 0x00=user) | `marker` (0x10=standard, 0x11=compact, 0xFE=alternate) |
| Compact-length flag | low bit of tcode (0x21 = compact str, 0x20 = wide) | the marker byte itself (0x11 = always 1-byte payload) |
| Object/message classification | first SYS_CMD value | leading tag *range* (0x1F40–0x1F5A = Device, 0x2328 = Group, …) |
| Magic | bare `4D 32` | `4D 32 01 00 FF 88 01 00` (8-byte preamble carrying type-code u32) |
| Continuation | none (single-shot messages) | `tag=0x0001 marker=0xFE tcode=0x08` SELF_ID separator; NAME field always last |
| Cross-references | handler paths in `SYS_TO`/`SYS_FROM` arrays | u32 fields that are foreign keys to other `objs.id` rows |

The current `winbox_m2.ksy` calls byte-2 `namespace` and dispatches on the
tcode's low bit. **Both choices are wrong for donny.** Trying to make one
`.ksy` describe both profiles ends in a mess of conditionals. The right
factoring is:

- A small, profile-agnostic **physical** layer: 4-byte header + a tcode
  table + the value-encoding rules (LE integers, length-prefixed bytes,
  recursive nested messages).
- One **profile** definition per usage context, naming bytes 2–3 according
  to local convention and binding tags to fields.

## Holes donny pokes that the IR must close

Each of these is a structural *capability* the IR currently lacks. Treat
this as the format-design checklist, not as protocol homework.

1. **Multiple profiles of one wire format.** Already discussed. Profiles
   compose: physical → profile → fields. A profile picks names for
   bytes 2–3, picks how compact-length is signaled, picks the
   classification scheme.

2. **Tag-range classification.** Donny's authoritative table (in its
   `DESIGN.md` and `RANGE` constant in `nova.ts`) maps `[0x1F40, 0x1F5A]
   → Device`, `[0x2328, 0x2337] → Group`, etc. The IR must let a profile
   declare "object type is determined by the leading section-1 tag
   falling into one of these ranges" and bind per-type field tables to
   each range.

3. **Semantic types layered above physical types.** A u32 can be:
   - a raw integer
   - an IPv4 address encoded as `a|(b<<8)|(c<<16)|(d<<24)` LE
   - a Unix timestamp
   - a foreign key to another object's id
   - an enum value with a per-field code table (LinkType.category 0=ethernet, 1=vlan, …)
   - a sentinel value (0xFFFFFFFF = "no value")
   The IR must distinguish physical from semantic so two fields that are
   both "u32 LE" but mean different things are not falsely conflated.

4. **Sentinels are first-class.** `DEVICE_TYPE_ID = 0xFFFFFFFF` means
   "no device type". `NOTIF_MAIL_V6 = 16 zero bytes` means "not
   configured". Empty string ≠ absent field. The IR needs a `sentinels:`
   list on a field, with each sentinel having a meaning.

5. **Cross-references / foreign keys.** Donny's `PROBE_DEVICE_ID = 0x2EE1`
   is a u32 that references a Device object's `id`. A schema that says
   "u32" loses this. The IR needs `references:` pointing at another
   field/type/profile, ideally checkable.

6. **Revision history (we were wrong).** Donny's nova.ts:
   ```
   /** @deprecated 0x1F42 is Device_Lookup; normalized dns_mode is
       derived from an empty IP list. */
   DEVICE_DNS_MODE: 0x1f42,
   ```
   A previous understanding ("0x1F42 is the DNS-mode flag") was
   overturned. The IR must record this so downstream users see a
   *signal* that prior code may need review. The user explicitly called
   this out: schema-as-signal-to-readers, not just schema-as-truth.
   `revision-history:` per field is not optional.

7. **Multiple names for one tag.** `0x1F58` is `DEVICE_CUSTOM_FIELD1`
   canonically and `DEVICE_NOTES` historically. The IR needs canonical-
   vs-alias distinction, not just a freeform `aka:` list. Aliases keep
   old code grepping.

8. **Repeated tags.** A device can carry multiple subnets in `0x2AF8`
   (twice or more in one object). Donny's diff API carries an `index`
   for exactly this reason. The IR must say a field is "repeated" or
   "single", and tooling must respect it.

9. **Structural delimiters.** Donny has SELF_ID acting as a section
   separator. M2 has section-1 / continuation. Other profiles will have
   their own. The IR needs `delimiter:` markers distinct from
   value-carrying fields.

10. **Round-trip coverage tracking.** Donny carefully separates "we
    understand this well enough to re-emit" (encoder-first) from "we
    only know how to pass it through" (raw fallback). The IR should
    flag, per type, whether re-encoding is a goal and whether it's
    achieved — that becomes the "% of the protocol we genuinely
    understand" metric.

11. **Built-in / baseline fixtures as evidence.** Donny commits
    `clean.db` (224 builtin objects, no PII). The IR's `evidence:`
    schema should accept fixture references — "see `clean.db` row id
    10191 for the ground-truth Device-type encoding".

12. **Schema-version signal.** Donny bumps `_meta.schema_version` on
    breaking changes. The IR should version each profile so consumers
    can detect "your m2ir snapshot is older than this protocol's
    current understanding".

## Sketch of the target shape

This is *one* concrete proposal. It's deliberately wordy so the design is
visible; tooling can collapse it. Open to revision once the second
profile (donny or other) is fully populated and we see what hurts.

```yaml
# m2ir: top-level container
m2ir-version: 0.1

physical:
  # The shared TLV grammar. Profile-agnostic.
  family: nova-message
  magic-prefix: ["M2"]                    # all nv::message blobs start here
  header:
    size: 4
    fields:
      - { name: tag,    width: u16le }
      - { name: byte_2, width: u1     }   # interpretation is profile-defined
      - { name: tcode,  width: u1     }
  tcodes:
    0x00: { name: bool_false, payload: none,                 value: false }
    0x01: { name: bool_true,  payload: none,                 value: true  }
    0x08: { name: u32,        payload: { fixed: 4, endian: le } }
    0x09: { name: u8,         payload: { fixed: 1 } }
    0x10: { name: u64,        payload: { fixed: 8, endian: le } }
    0x18: { name: bytes_16,   payload: { fixed: 16 },        notes: "ipv6 in some profiles" }
    0x20: { name: string_l,   payload: { len-prefix: u16le, body: utf8 } }
    0x21: { name: string_s,   payload: { len-prefix: u8,    body: utf8 } }
    0x28: { name: msg_l,      payload: { len-prefix: u16le, body: nova-message } }
    0x29: { name: msg_s,      payload: { len-prefix: u8,    body: nova-message } }
    0x30: { name: bytes_l,    payload: { len-prefix: u16le, body: opaque } }
    0x31: { name: bytes_s,    payload: { len-prefix: u8,    body: opaque } }
    0x88: { name: u32_array,  payload: { count: u16le, item: u32 } }
    0xa0: { name: compound,   payload: { count: u16le, item: nested-fields-or-u16len-string },
            notes: "polymorphic; profile decides per tag" }
    0xa8: { name: msg_array,  payload: { count: u16le, item: msg_l } }
    0x80: { name: bool_array, status: declared-unwired }
    0x90: { name: u64_array,  status: declared-unwired }

semantic-types:
  ipv4-le-u32:    { physical: u32, format: "a|(b<<8)|(c<<16)|(d<<24)" }
  ipv6-bytes:    { physical: bytes_16 }
  unix-timestamp:{ physical: u32, unit: seconds-since-epoch }
  mac-address:   { physical: { fixed: 6 } }
  duration-secs: { physical: u32, unit: seconds }
  obj-id-ref:    { physical: u32, role: "foreign key into <profile>.<object-class>" }

confidence-levels:
  - { id: documented,    rule: "named in a public source; evidence required" }
  - { id: inferred,      rule: "derivable from documented facts; evidence required" }
  - { id: observed-only, rule: "stable in real captures; sample reference required" }
  - { id: guessed,       rule: "best-effort with no grounding; should not be trusted" }
  - { id: superseded,    rule: "previous understanding now known wrong; revision-history required" }

profiles:

  winbox-ipc:
    description: "RouterOS IPC over TCP/8291; this project's domain."
    transport-ref: { document: PROTOCOL.md, section: "2. Frame Format" }
    magic: ["M2"]                          # bare 2-byte magic
    structure: { repeat: tlv-entry, until: eos }
    byte-2-as: namespace
    namespaces:
      0xff: { name: system,   abbrev: SYS }
      0xfe: { name: standard, abbrev: STD }
      0x00: { name: user,     abbrev: USER }
    compact-rule: low-bit-of-tcode         # 0x21=compact str, 0x20=wide str
    classification:
      kind: "by SYS_CMD value"
      target-field: 0xff0007
    fields: { ref: profiles/winbox-ipc/fields.yaml }
    commands: { ref: profiles/winbox-ipc/commands.yaml }

  dude-on-disk:
    description: "Per-row blob in dude.db `objs.obj`; referenced impl: github.com/tikoci/donny."
    magic: [0x4d, 0x32, 0x01, 0x00, 0xff, 0x88, 0x01, 0x00]
    magic-notes: "Bytes 2-7 are themselves a TLV header; byte 8 onward is a u32 array element naming the object class. Donny treats the first 12 bytes as constant-discardable."
    structure:
      - section-1:    { repeat: tlv-entry, until: continuation-separator }
      - continuations:{ repeat: tlv-entry, separator: "tag=0x0001 marker=0xFE tcode=0x08" }
      - last-field:   NAME
    byte-2-as: marker
    markers:
      0x10: { name: standard,  width-rule: from-tcode }
      0x11: { name: compact,   width-rule: always-1-byte }
      0xfe: { name: alternate, width-rule: from-tcode, also: continuation-separator }
    compact-rule: marker-byte               # 0x11 means always-1-byte payload, regardless of tcode
    classification:
      kind: "by leading-tag range"
      ranges:
        - { range: [0x1f40, 0x1f5a], type: device }
        - { range: [0x2328, 0x2337], type: group }
        - { range: [0x2710, 0x271f], type: device-type }
        - { range: [0x2af8, 0x2afa], type: network }
        - { range: [0x2ee0, 0x2ef4], type: probe-config }
        # ... full list lifted from donny RANGE constants
    object-classes: { ref: profiles/dude-on-disk/objects/ }

# ── per-field example: parallel WinBox-IPC and Dude entries ────────────
fields:

  - id: winbox-ipc.SYS_CMD
    profile: winbox-ipc
    tag: 0x0007
    namespace: 0xff
    canonical-name: SYS_CMD
    aliases: []
    physical: { tcodes: [0x08, 0x09] }       # u32 or u8 in the wild
    semantic: command-code
    confidence: documented
    evidence:
      - { source: code, ref: "Cisco-Talos Winbox_Dissector.lua:205" }
    notes: "Encoded as u8 for STD_CMD short-form (cmdGet=7, cmdOpen=5) and u32 for handler-private (e.g. 0x0A0065)."
    revision-history: []

  - id: dude-on-disk.device.ip
    profile: dude-on-disk
    object-class: device
    tag: 0x1f40
    canonical-name: Device_Ip
    aliases: [DEVICE_IP]
    physical: { tcodes: [0x88] }              # u32 array (typically 1 element; multiple = multi-homed)
    semantic: ipv4-le-u32
    repeated: true
    sentinels:
      - { value: 0xffffffff, meaning: "no IPv4 address; device is DNS-mode (see Device_DnsNames)" }
    confidence: documented
    evidence:
      - { source: code, ref: "donny src/lib/nova.ts TAG.DEVICE_IP" }
      - { source: fixture, ref: "donny clean.db" }
    revision-history: []

  - id: dude-on-disk.device.dns_mode
    profile: dude-on-disk
    object-class: device
    tag: 0x1f42
    canonical-name: Device_Lookup
    aliases:
      - { name: DEVICE_DNS_MODE, status: superseded }
    physical: { tcodes: [0x00, 0x01] }        # bool
    semantic: bool
    confidence: documented
    revision-history:
      - date: "before-2025-Q3"
        belief: "0x1F42 = DNS-mode flag (true if device addressed by hostname)"
        outcome: superseded
      - date: "2025-Q3"
        belief: "0x1F42 = Device_Lookup; DNS-mode is derived from absence of Device_Ip"
        evidence:
          - { source: experiment, ref: "RouterOS 7.21.4 CHR with Dude package, CLI device creation" }
        outcome: current
    review-signal: |
      Code that branched on 0x1F42 to decide DNS-mode behavior should be
      reviewed against the new understanding. Donny includes a
      `@deprecated` alias in `nova.ts` to preserve grep paths.
```

A real m2ir snapshot is bigger than this fits — fields would split into
files under `profiles/<name>/fields/<class>.yaml`, classes into
`profiles/<name>/objects/<class>.yaml`, etc. The shape is what matters
here.

## North star: the imagined output

Even if it never gets generated, picturing the *final form* keeps the IR
honest. The endpoint that makes sense is something close to a C header
RouterOS itself would have if its protocol descriptions were public:

```c
/* generated from m2ir; do not edit */

/* ── physical ── */
typedef enum { NV_TC_BOOL_FALSE = 0x00, NV_TC_BOOL_TRUE = 0x01,
               NV_TC_U32 = 0x08, NV_TC_U8 = 0x09, ... } nv_tcode_t;

/* ── winbox-ipc profile ── */
#define NV_SYS_TO       0xFF0001
#define NV_SYS_FROM     0xFF0002
#define NV_SYS_CMD      0xFF0007
/* ... */

/* ── dude-on-disk profile ── */
#define DUDE_TAG_DEVICE_IP        0x1F40   /* ipv4-le-u32; sentinel 0xFFFFFFFF = DNS-mode */
#define DUDE_TAG_DEVICE_LOOKUP    0x1F42   /* bool; SUPERSEDED alias DEVICE_DNS_MODE */

typedef struct {
    uint32_t id;
    uint32_t ip;          /* tag 0x1F40, sentinel 0xFFFFFFFF = no IPv4 */
    char *dns_names[];    /* tag 0x1F41 */
    /* ... */
} dude_device_t;
```

Real RouterOS source presumably has something close to this, generated
from whatever protocol-description format MikroTik uses internally
(plausibly a lex/yacc-style grammar). m2ir is the *recovery* of that:
working backwards from wire/disk traces and public RE to reconstruct the
implied protocol description.

We are not committing to actually generating C headers. But every IR
design choice gets stress-tested against "could this produce a clean
.h?" If the answer is no, the IR has a layering problem. The constraints
this surfaces:

- Every named entity must round-trip to a valid C identifier.
- Variant unions must have a representable shape (tagged unions, anon
  unions inside structs, or distinct types).
- Semantic types must bind to concrete C types so a generator has
  something to emit.
- Sentinels must be expressible as `#define` constants.
- Revision history is a *commentary* layer in the .h output, not a
  structural one — but it must survive regeneration.

JSON Schema, TypeScript types, a Wireshark dissector, and an HTML
human-readable doc are the other plausible derivation targets. Any of
them passes the same "is the IR rich enough?" test.

## Concept catalog: cross-profile semantic identity

MNDP exposes the design need: same *meaning* (RouterOS identity, board
model, uptime in seconds, IPv4 address) appears across profiles under
different physical encodings and different tags. m2ir needs a layer
above profile-specific fields where these concepts live once.

```yaml
concepts:
  routeros-identity:
    description: "The configured /system/identity hostname of a RouterOS device."
    physical-options:
      - { layer: nv-message, tcode: [0x20, 0x21], encoding: utf8-string }
      - { layer: mndp,       tcode: 0x05,        encoding: utf8-string-no-len-prefix }
    appearances:
      - { profile: mndp,           tag: 0x05 }
      - { profile: dude-on-disk,   tag: 0x0010, in-class: any, name: NAME }
      - { profile: winbox-cdb,     tag: ?,      confidence: not-yet-investigated }
    notes: "Devices typically default to the board model string."

  uptime-seconds:
    description: "Seconds since system boot."
    physical-options:
      - { layer: any, encoding: u32-LITTLE-ENDIAN }
    appearances:
      - profile: mndp
        tag: 10
        warning: |
          The ONLY little-endian integer in MNDP. All other MNDP integers
          are big-endian. Single most common MNDP parsing footgun.
    sentinels: []

  ipv4-address:
    physical-options:
      - { layer: nv-message, tcode: 0x88, encoding: u32-le-as-bytes,
          format: "a|(b<<8)|(c<<16)|(d<<24)" }
      - { layer: nv-message, tcode: 0x31, encoding: 4-raw-bytes,
          format: "[a, b, c, d]" }
      - { layer: mndp,       tcode: 17,   encoding: 4-raw-bytes }
    sentinels:
      - { value: 0xFFFFFFFF, meaning: "absent / DNS-mode (donny)",
          scope: "scope-specific; not universal across profiles" }
```

Profile fields then become thin: `concept-ref: routeros-identity` and
the binding is one line. Adding a new profile mostly means binding
existing concepts to new tags. Which is a *good* sign — most of the work
on a new profile should be re-using known concepts, not redefining them.

## Magic bytes vs unknown bytes — refined framing

The strawman lumped these into one "apparent-magic" flag. With more
evidence in hand, three categories distinguish:

| Category | Definition | IR field |
|---|---|---|
| **Magic** | Bytes that *identify* a structure. The `M2` prefix says "this is an nv::message". `0d f0 1d c0` says "this is an open WinBox CDB file". `0d f0 11 40` says "this is an *encrypted* WinBox CDB file". The bytes have a known semantic role. | `magic: true; identifies: <name>` |
| **Constant-by-spec** | Bytes whose value is fixed but whose role is structural rather than identifying. The `0xFF` continuation tag in WinBox chunks. The `01 00 FF 88 01 00` after the M2 magic in dude-on-disk (which is itself a TLV header for the type-code u32 array). Knowing what they *are* is part of the protocol; their value is just spec. | `constant: <bytes>; role: <description>` |
| **Unknown** | Bytes we don't yet understand. Often `0` in every capture, or stable but unexplained. Likely unimportant in the contexts we've examined, but we don't know that for sure. | `unknown: true; observed: <samples>; investigation-trail: [...]` |

The category boundaries shift over time. Today's `unknown` is tomorrow's
`constant-by-spec` or `magic`. The IR records *which category we believe
and why* so a future agent doesn't re-litigate. The
`investigation-trail:` is the antidote to the user's stated frustration:
"if wrong, it [means] re-reading MarginResearch and some assortment of
github to then realize it's just not known but now needed". A field
with `investigation-trail: [{date, source, finding: not-found}]` is
self-documenting evidence that the search was done — next agent can
skip.

## File splits — earlier than originally suggested

The first DESIGN.md draft said "avoid splitting prematurely". With four
profiles in hand and the natural seams now visible, the better advice is
**split at the natural boundaries from day one** even if individual
files are small. Context-window-driven thinking: an agent working on
"dude device fields" should not also load MNDP and CDB context.

Concrete first-day layout:

```
m2ir/
  README.md
  DESIGN.md
  context-rules.md
  meta-schema.yaml             # JSON Schema for m2ir itself, when ready
  physical/
    nv-message.yaml            # tag/marker/tcode grammar (3 profiles use this)
    mndp.yaml                  # entirely different TLV grammar
  concepts/
    network.yaml               # ipv4, ipv6, mac, etc.
    routeros.yaml              # identity, version, board, license-id, ...
    time.yaml                  # uptime, timestamps, intervals
    references.yaml            # obj-id-ref, foreign-key concept
  profiles/
    winbox-ipc/
      profile.yaml             # transport + top-level discriminator
      sys-keys.yaml            # SYS_*/STD_* enum
      handlers/
        mepty.yaml             # discriminator on SYS_CMD
        mproxy.yaml
        _generic.yaml
      commands/
        mepty-login.yaml       # field table for one command
        mepty-data.yaml
    dude-on-disk/
      profile.yaml             # discriminator on leading-tag range
      objects/
        device.yaml
        group.yaml
        # one file per RANGE entry from donny
    winbox-cdb/
      profile.yaml             # discriminator on tag-1 (recordType)
      records/
        mac-target.yaml
        ip-admin.yaml
        ip-user.yaml
        romon-neighbor.yaml
        romon-target.yaml
    mndp/
      profile.yaml             # discriminator on per-TLV tag (degenerate)
  fixtures/                    # raw bytes referenced by `evidence:`
    winbox-ipc/
    dude-on-disk/
      clean.db.sample          # may symlink to donny's clean.db
    winbox-cdb/
    mndp/
```

Splitting concept files by domain (network/routeros/time) rather than
by profile keeps cross-profile reuse natural — the `routeros-identity`
concept is one entry in `concepts/routeros.yaml` referenced from four
profiles, not four separate fields with copy-pasted commentary.

## What this doesn't decide

These are open and worth deliberate design before scaling coverage:

- **Validation tooling.** A JSON Schema for m2ir itself ("meta-schema")
  would let CI lint that every field has the required keys, every
  `confidence: observed-only` has at least one sample evidence, every
  `references:` resolves. Worth designing once the shape stabilizes
  across two profiles.

- **Where Kaitai sits.** I currently believe: not the canonical artifact,
  but a useful generated output. `m2ir → ksc-compiler-ready .ksy` is a
  small generator. JS test fixtures (Bun) consume the generated parser.
  But maybe Kaitai isn't even the right binary-grammar target — maybe
  it's a tiny bespoke parser checked into each consuming project. Worth
  trying both before committing.

- **How to encode "byte 2 is overloaded".** Same byte position, two
  semantic roles depending on profile (namespace vs marker vs
  hypothetical RoMON-routing-flag). Should the IR call it
  `byte_2_role: namespace | marker | ...` and let each profile tag-name
  it? Or should profiles override the entire header definition? The
  sketch above takes the first path; the second is more general but
  more verbose.

- **How to express conditional / contextual fields.** "When SYS_CMD =
  meptyLogin, the user-namespace key_5 means terminal columns; when
  SYS_CMD = meptyData, key_5 is unused." This is the same problem as
  Dude's tag-range classification, donny's leading-tag dispatch, and
  winbox-cdb's recordType dispatch — generalized. Concrete proposal in
  [`context-rules.md`](context-rules.md): one `discriminator` block
  with a small grammar of `source` (field-by-tag, leading-tag,
  computed, transport-hint), `match` (exact, range, predicate), and
  `variants` (each a `$ref` to a separate field-table file). Worked
  examples for all four profiles. The cross-profile concept-catalog
  layer (above) and the discriminator mechanism together cover what
  one giant flat field table cannot.

- **Confidence on the IR itself, not just on entries.** Some profiles
  (winbox-ipc, dude-on-disk) are well-grounded. Others (RoMON, mproxy)
  will start mostly speculative. A profile-level `maturity: stable |
  exploratory | speculative` would let consumers filter.

- **Round-trip claim.** Per object class: `roundtrip: read-only |
  encode-fallback | full`. Donny tracks this implicitly via its
  encoder-coverage gap report. Surfacing it in m2ir means downstream
  tooling can pick "use fields I can re-encode losslessly only".

## What is already known and ought to land in m2ir

Roughly in priority order — these are existing knowledge sources that
should be drained into the IR before anyone tries to extend coverage to
new protocols. Pulling them in is the *real* next concrete work; doing
it carefully is what tests the format.

1. **Cisco-Talos `Winbox_Protocol_Dissector` Lua tables.** The complete
   SYS_*/STD_*/CMD_*/ERROR_* enums and the `typeIDCode` process-id
   table. This grounds the `winbox-ipc` profile's `documented` tier.
   Lift verbatim with `confidence: documented`,
   `evidence: { source: code, ref: "Cisco-Talos Winbox_Dissector.lua:Lxxx" }`.

2. **Donny `nova.ts` TAG and RANGE constants + `DESIGN.md` table.** The
   complete tag catalog for the `dude-on-disk` profile, plus the C++
   field names from RouterOS source where donny has them. This is the
   single largest existing knowledge bank — easily 200+ named tags
   across ~20 object classes, with sentinels, FK relationships, and
   superseded beliefs already curated. Most rows can be confidence
   `documented`.

3. **MarginResearch + Tenable write-ups.** Architecture-level facts
   (24-bit keys, `nv::Handler`, EC-SRP5 design, `mproxy` handler #2,
   policy bitmask values). These flesh out the `winbox-ipc` profile
   with cross-cutting context, and seed the `mproxy` and `undo` object
   classes at confidence `documented`.

4. **This project's PROTOCOL.md and Python code.** The `mepty` handler
   slice — meptyLogin / meptyData / the user-namespace keys. After
   reconciling against Cisco-Talos's canonical names (with the
   PROTOCOL.md mislabels recorded as superseded aliases), this becomes
   the single fully-worked example of a handler-private command set
   inside `winbox-ipc`.

5. **`tikoci/restraml` schema data.** The RouterOS REST API has its own
   schema covering /ip/, /interface/, etc. — same router, same field
   semantics, different transport. Where m2ir's `winbox-ipc` profile
   names a key like `Device_Ip`, restraml has the corresponding REST
   path. Cross-link as `corresponds-to: restraml://...` so an agent
   working on one side can find the other.

6. **`tikoci/mikropkl` and friends.** Pkl describes RouterOS *config*
   structure declaratively. Some of its types (IP, MAC, interface name,
   identity) are `semantic-types` candidates that should live in m2ir
   so all profiles share them.

7. **Mikrotik forum posts and MUM presentations.** Lower confidence,
   often `inferred` or `observed-only`, but capture them with citation
   so the IR has the *trail* even when the evidence is weak.

This list is roughly the "100k tokens we don't want re-spent". Pulling
each source through the IR once means the next agent gets it for free.

## A word on tone

`m2ir` is a tool for *durable institutional memory*, not a parser
shipped to production. Every entry is a small claim with a citation.
Wrong entries are not bugs; they're prior beliefs with revision history.
The IR's success metric is "an agent six months from now reads it and
gets the current understanding faster than re-deriving from the web".

That's why the format design matters more than the coverage. A good
format makes additions easy and corrections visible. A bad format silos
knowledge in `.ksy` enums where nobody can tell `documented` from
`guessed`.

— second pass; supersedes the deleted FUTURE.md
