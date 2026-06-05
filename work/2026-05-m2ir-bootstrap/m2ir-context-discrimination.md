# context-rules — discrimination in m2ir

_Imported from `subixonfire/winbox-terminal-protocol/schema/context-rules.md` and lightly adapted for this repository's initial bootstrap._

The crux of the IR problem. A field's *encoding* is described by tcode +
marker. A field's *meaning* depends on context: which command is in
flight, which object class this blob represents, what value some sibling
field carries. Without a clean way to express that, the IR collapses
either into one giant flat field table (wrong) or into per-profile
hardcoded conditionals (worse).

This doc surveys how adjacent ecosystems express the same problem,
catalogs the four discrimination patterns we already see across known
profiles, and proposes a single mechanism that covers all four.

## The four patterns we already have evidence for

| Profile | Discriminator | Mapping kind | Source |
|---|---|---|---|
| `winbox-ipc` | the `SYS_CMD` field's value | exact-match | this project + Cisco-Talos |
| `dude-on-disk` | the leading section-1 tag's *numeric range* | range-match | `~/GitHub/donny` |
| `winbox-cdb` | the `recordType` field's value (tag 1) | exact-match | `tikoci/centrs` `src/data/winbox-cdb.ts` |
| `mndp` | the per-TLV type code | exact-match, but it's the field's own tag | `mcp-mikrotik` |

A fifth, hypothetical pattern — predicate-match (e.g. "if any flag bit is
set in field X, this variant applies") — is not yet observed but should
not be designed out.

The patterns share one shape: **(a) a way to obtain a value, (b) a way to
match that value, (c) a per-match field table**. Everything else is a
parameter. That's the unification.

## Survey of similar mechanisms

### JSON Schema: `if` / `then` / `else` and `dependentSchemas`

```json
{
  "if":   { "properties": { "kind": { "const": "device" } } },
  "then": { "$ref": "#/$defs/device-fields" },
  "else": { "if": ..., "then": ..., "else": ... }
}
```

Pros: standard, validatable, pure data. Cons: chained `if/else` for
N variants is verbose and order-dependent. `dependentSchemas` is
slightly cleaner for "if field X exists" but doesn't help for value-
match.

### OpenAPI: `discriminator` + `mapping`

```yaml
discriminator:
  propertyName: kind
  mapping:
    device:  '#/components/schemas/Device'
    group:   '#/components/schemas/Group'
oneOf:
  - $ref: '#/components/schemas/Device'
  - $ref: '#/components/schemas/Group'
```

Pros: declarative, value→variant is a flat table, easy to extend. The
closest fit. Cons: tied to JSON-style property names; no native range or
predicate match; values are strings.

### Keichi binary-parser: `.choice()`

```js
new Parser()
  .uint8("tag")
  .choice("payload", { tag: "tag", choices: { 0x01: macParser, 0x05: identityParser } })
```

Pros: ergonomic, supports nesting, runtime-dispatched. Cons: lives in
JavaScript code, not data. Inspirational for *shape* but not as the
canonical artifact.

### Tagged unions in algebraic-data-type languages

Rust's `enum` with `#[serde(tag = "type", content = "data")]`, Haskell's
`data Foo = A Int | B String`, Swift's `enum Foo { case a(Int); case
b(String) }`. The mental model the IR wants: a profile is a tagged union
over object classes / commands / record types; the discriminator is the
tag.

### What none of these handle out of the box

- **Range mapping** (donny). "Tag in `[0x1F40, 0x1F5A]` → device" is a
  predicate on a numeric range. JSON Schema can fake it with `minimum` /
  `maximum`, but OpenAPI's `mapping:` cannot.
- **Discriminator from a header rather than a sibling property**. In
  winbox-cdb the `recordType` is a TLV field like any other, but it
  semantically *precedes* and *governs* the rest. The discriminator must
  be locatable by tag, not just by JSON property name.
- **Cascaded discrimination**. winbox-ipc dispatches first on
  `SYS_TO[0]` (process id) to pick a handler family, then on `SYS_CMD`
  to pick the command within that handler. Two levels of choice.

## Proposed mechanism

A single `discriminator` block with a small grammar of source + match-kind
+ variants. Examples are concrete; the schema for the schema can be
formalized later.

### Skeleton

```yaml
discriminator:
  source:                   # how to obtain the discriminator value
    kind: <field-by-tag | field-by-id | leading-tag | computed | transport-hint>
    ...                     # kind-specific parameters
  match: <exact | range | predicate>
  variants:
    - { when: ..., variant: <ref | inline> }
  default: <ref | inline | error>
```

`source.kind`:
- `field-by-tag` — find the field with this tag in the current message;
  the discriminator is its value. Used for winbox-cdb (tag=1) and
  winbox-ipc (tag=SYS_CMD).
- `field-by-id` — same as above but by m2ir field-id. Useful when the
  same semantic field has different tags in different sub-profiles.
- `leading-tag` — the *tag itself* of the first field in this section.
  Used for dude-on-disk (the tag's value, not its payload, classifies
  the object).
- `computed` — small expression over multiple fields (e.g.
  "process_id from SYS_TO[0] combined with SYS_CMD"). Use sparingly;
  this is where complexity creeps in.
- `transport-hint` — value supplied by the parser host out-of-band
  (e.g. "we know this is a request because we just sent it"). Reserved
  for the rare cases where the wire data alone doesn't determine the
  profile.

`match`:
- `exact` — value equals a constant.
- `range` — value falls in `[lo, hi]`.
- `predicate` — small expression. Only when neither exact nor range
  works; the IR should prefer rewriting to one of the simpler forms.

`variants[].variant` is either a `$ref` to a separate field-table file
or an inline list. **Strongly prefer `$ref`** for context-window reasons
(see DESIGN.md on file splits).

### Worked example: `winbox-cdb`

The CDB file is a sequence of records; each record's tag-1 value picks
the record class. Centrs already implements this in `winbox-cdb.ts`.

```yaml
profiles:
  winbox-cdb:
    discriminator:
      source: { kind: field-by-tag, tag: 0x0001 }   # recordType
      match: exact
      variants:
        - when: 2, variant: { $ref: profiles/winbox-cdb/records/mac-target.yaml }
        - when: 5, variant: { $ref: profiles/winbox-cdb/records/ip-admin.yaml }
        - when: 6, variant: { $ref: profiles/winbox-cdb/records/ip-user.yaml }
        - when: 7, variant: { $ref: profiles/winbox-cdb/records/romon-neighbor.yaml }
        - when: 8, variant: { $ref: profiles/winbox-cdb/records/romon-target.yaml }
      default: { variant: { $ref: profiles/winbox-cdb/records/_unknown.yaml } }
```

Each variant file enumerates the fields valid for that record class —
`romon-target.yaml` would have tag 11 = `romonAgent` (a u32 reference to
the agent's record id), tag 12 = `profile`, etc.

### Worked example: `dude-on-disk`

Donny's classification is by *leading tag value*, falling into ranges.

```yaml
profiles:
  dude-on-disk:
    discriminator:
      source: { kind: leading-tag, skip-if-tag: 0x0001 }   # if first field is SELF_ID, look at the next
      match: range
      variants:
        - when: { range: [0x1F40, 0x1F5A] }
          variant: { $ref: profiles/dude-on-disk/objects/device.yaml }
        - when: { range: [0x2328, 0x2337] }
          variant: { $ref: profiles/dude-on-disk/objects/group.yaml }
        - when: { range: [0x2710, 0x271F] }
          variant: { $ref: profiles/dude-on-disk/objects/device-type.yaml }
        # ... full RANGE table from donny
      default: { variant: { $ref: profiles/dude-on-disk/objects/_unknown.yaml } }
```

`skip-if-tag` handles donny's quirk that some objects start with SELF_ID
and the *real* classifier is the second tag. That's a small concession to
real-world messiness — codify it once in the source kind, not as a
profile-level conditional.

### Worked example: `winbox-ipc` (cascaded)

Two-level dispatch: process id picks the handler family; the command code
within that family picks the command. Discriminators *nest*: a variant's
field table can itself contain a discriminator.

```yaml
profiles:
  winbox-ipc:
    discriminator:
      source: { kind: field-by-tag, tag: 0xff0001, index: 0 }   # SYS_TO[0] = process_id
      match: exact
      variants:
        - when: 0x0a, variant: { $ref: profiles/winbox-ipc/handlers/mepty.yaml }
        - when: 0x02, variant: { $ref: profiles/winbox-ipc/handlers/mproxy.yaml }
        # ... rest of process_id table
      default: { variant: { $ref: profiles/winbox-ipc/handlers/_generic.yaml } }
```

```yaml
# profiles/winbox-ipc/handlers/mepty.yaml
discriminator:
  source: { kind: field-by-tag, tag: 0xff0007 }   # SYS_CMD
  match: exact
  variants:
    - when: 0x0a0065, variant: { $ref: ../commands/mepty-login.yaml }
    - when: 0x0a0067, variant: { $ref: ../commands/mepty-data.yaml }
  default: { variant: { $ref: ../commands/_generic.yaml } }
```

```yaml
# profiles/winbox-ipc/commands/mepty-login.yaml
fields:
  - { tag: 0x0005, ns: 0x00, concept: terminal-cols,     name: cols }
  - { tag: 0x0006, ns: 0x00, concept: terminal-rows,     name: rows }
  - { tag: 0x0007, ns: 0x00, concept: terminal-type,     name: term }
  - { tag: 0x0001, ns: 0x00, concept: routeros-password, name: password }
  - { tag: 0x000B, ns: 0x00, concept: routeros-policy,   name: policy_msg, type: nested-message }
```

This is what answers the original question: when `SYS_CMD = meptyLogin`,
key_5 means terminal columns; when `SYS_CMD = meptyData`, key_5 isn't in
the field list at all. The two commands have separate field-table files;
the discriminator routes between them; nothing is conditional within a
file. Files stay small and context-window-friendly.

### Worked example: `mndp`

Discrimination by the field's own tag — every TLV in MNDP knows its
encoding from its own type code. This degenerates to "every field has its
own variant" and the discriminator is essentially the field-table
lookup. The IR can express this with the same mechanism, but it's worth
noting that it's the trivial case:

```yaml
profiles:
  mndp:
    physical: { $ref: physical/mndp-tlv.yaml }    # different from nv-message
    discriminator:
      source: { kind: leading-tag }    # the TLV's own type code
      match: exact
      variants:
        - when: 1,  variant: { fields: [{ concept: mac-address,    name: mac, length: 6 }] }
        - when: 5,  variant: { fields: [{ concept: routeros-identity, type: utf8-string }] }
        - when: 7,  variant: { fields: [{ concept: routeros-version,  type: utf8-string }] }
        - when: 10, variant: { fields: [{ concept: uptime-seconds,    type: u32-LITTLE-ENDIAN,
                                          notes: "the only LE integer in the protocol — common parsing footgun" }] }
        # ... etc
      default: { variant: { collect-as: unknown-tlv } }   # mndp.ts's unknownTlvs[] pattern
```

The `notes:` line lifts the user's "single most common parsing footgun"
warning from the MNDP source comment — that's exactly the kind of
hard-fought knowledge the IR must preserve, and the discriminator-table
form keeps it next to the field it warns about.

## Composition rules

1. **A profile has at most one top-level discriminator.** If a profile
   needs more, it cascades by referencing variants that themselves have
   discriminators.
2. **A discriminator's variants either are field tables or contain
   another discriminator.** Two clear node types, no third.
3. **Field tables resolve `concept:` references against the global
   concept catalog** (see DESIGN.md). A field with `concept: ipv4-address`
   inherits sentinel values, formatting rules, and the `documented`
   evidence baseline from the concept; profile-specific overrides are
   merged on top.
4. **Default variant is required**, even if it just routes to
   `_unknown.yaml`. Forces every profile to have a graceful-degradation
   path for new/unobserved cases.

## Why not just JSON Schema directly

Two reasons:
- JSON Schema's primary axis is JSON (named keys), not binary (numbered
  tags). Translation is possible but lossy and verbose.
- The IR is not just a *validator* of parsed data — it's the canonical
  description of the protocol. Generated outputs include a parser/encoder
  pair, a C header, a TypeScript type, a human-readable doc, possibly a
  Wireshark dissector. JSON Schema covers maybe 30% of that.

We *can* generate JSON Schema for the parsed AST as one output target.
Just not use it as the source of truth.

## Open questions for context-rules specifically

1. **Range overlap.** If a `range` discriminator has overlapping ranges,
   which wins? Probably "first match wins, lint-error on overlap".
2. **Field-by-tag with namespaces.** In `winbox-ipc`, fields have a
   namespace byte. Should `field-by-tag` accept `(tag, ns)` pairs?
   Probably yes for consistency; current sketch shorthands single-tag
   when ns is implicit.
3. **What if the discriminator field is *missing*?** Some captures will
   be incomplete. Default variant handles "value didn't match" but not
   "value didn't exist". Probably: if missing, emit a parse-time warning
   and route to default.
4. **Schema for the discriminator schema** — meta-meta-schema. Worth a
   small JSON Schema once the shape is firm enough that it stops
   wiggling. Not now.
5. **How does `concept:` interact with `repeated`?** A repeated field of
   `concept: ipv4-address` should naturally be a list. Implementation
   detail; codify after first use.
6. **Variants that share fields.** Most CDB record types share `user`
   (tag 2) and `password` (tag 3). Do we duplicate those into every
   variant or `$ref` a "common" partial? Probably the latter, with a
   well-named convention like `common-fields: [...]` at the variant
   level.

## Adjacent reads

- [keichi/binary-parser](https://github.com/keichi/binary-parser) —
  fluent JS DSL for binary parsers. Inspiration for shape.
- [JSON Schema 2020-12 §10.2 if/then/else](https://json-schema.org/draft/2020-12/json-schema-core#name-applying-subschemas-conditi) —
  reference for the validator-style approach.
- [OpenAPI 3.1 discriminator](https://spec.openapis.org/oas/v3.1.0#discriminator-object) —
  closest existing standard to the proposed `source + variants` block.
- [Kaitai Struct switch-on/cases](https://doc.kaitai.io/user_guide.html#switching) —
  the pattern lives there too, but tied to a specific compiler.
- `tikoci/centrs/src/data/winbox-cdb.ts` — concrete reference impl of a
  `field-by-tag` discriminator (record types).
- `~/GitHub/donny/src/lib/nova.ts` `RANGE` constants — concrete reference
  impl of a `leading-tag` + `range` discriminator.
- `mcp-mikrotik/src/mndp.ts` — concrete reference
  impl of a `leading-tag` + trivial-exact discriminator, plus the
  unknown-collection default-variant pattern.
