# WinBox Wireshark dissector feasibility from current m2ir schema

## Question

Can the current `profiles/winbox-ipc/` schema generate the data structures a
Wireshark dissector would need, without additional research, and is it already
better grounded than the drained Cisco-Talos Lua tables?

## Short answer

Yes, for the **data-model layer**.

The current schema is already regular enough to generate dissector-oriented
lookup tables and message descriptors automatically from YAML. It is also
already **broader than the Cisco-Talos dissector tables** in several useful
areas: transport framing, EC-SRP5 handshake structure, version-scoped process
identity notes, handler-scoped `mproxy` command metadata, field aliases, and
schema-carried open questions.

No, for a **fully complete WinBox dissector**.

The remaining blockers are not plumbing problems. They are coverage problems:
the schema still lacks large parts of the handler-private command catalogs,
many user-namespace fields, and stable per-version process / handler maps for
all RouterOS eras. A generated dissector could be materially better than the
drained Talos baseline today, but it would still be partial.

## What the schema already captures well enough

The current winbox profile already exposes the main categories a dissector
normally hard-codes:

| Need in a dissector | Present in m2ir now | Notes |
| --- | --- | --- |
| TLV physical types | Yes | `physical/nv-message.yaml` has `tcode` names, payload rules, recursion, and compact/wide distinctions. |
| Transport chunk tags | Yes | `profiles/winbox-ipc/transport.yaml` models plaintext, encrypted, and continuation chunks. |
| Full-key to field-name map | Yes | `sys-keys.yaml` and `std-keys.yaml` carry canonical names, tcodes, semantics, roles, aliases, and some enum values. |
| Standard command labels | Yes | `std-commands.yaml` is already a direct command-value table. |
| Standard error labels | Yes | `std-errors.yaml` maps `SYS_ERRNO` values. |
| Process / namespace labels | Yes, with caveats | `processes.yaml` is richer than Talos because it records version conflicts instead of flattening them away. |
| Handler-scoped command metadata | Partially | `commands.yaml` and `mproxy.yaml` already describe the public `mproxy` handler-2 surface. |
| Handshake message structure | Yes | `ec-srp5-handshake.yaml` gives phase names and shapes. |
| Remaining unknowns | Yes | Open questions are explicit in the schema and can be surfaced by tooling. |

That is enough to synthesize the kind of intermediate tables a dissector would
consume:

1. `ProtoField`-like field definitions from key catalogs.
2. `value_string`-like label tables from enums and command maps.
3. `SYS_CMD` dispatch tables split by standard, legacy-short-form,
   handler-private, and handler-scoped spaces.
4. Transport and handshake dispatch metadata for top-level subtree selection.
5. Warnings or expert-info candidates from `open-questions` and version-scope
   notes.

## Proof: small generated shape from current YAML

To test this directly, I added a small Bun/TypeScript generator:

- `src/tooling/winbox-dissector-shape.ts`
- `test/tooling/winbox-dissector-shape.test.ts`

The generator reads the existing YAML and emits a single intermediate object for
dissector-oriented consumption. It does **not** implement Wireshark plumbing,
only the schema-to-data transformation.

Running:

```text
bun src/tooling/winbox-dissector-shape.ts
```

currently yields a generated shape with:

- 45 fields
- 11 value tables
- 5 command spaces
- 30 commands
- 5 handshake messages
- 7 carried-forward open questions

The important part is not the exact counts. The important part is that these
tables were derived automatically from the current schema without adding any new
protocol facts.

## Why this is already better than the drained Cisco-Talos baseline

The Cisco-Talos dissector mostly gave us flat tables: command names, error
names, namespace keys, and one reference-version process map.

The current schema can generate those same flat tables, but it can also carry
more useful structure that a better dissector could exploit:

1. **Version-scoped process identity**
   - `processes.yaml` records conflicting identities like `0x0d` rather than
     pretending there is one timeless truth.
2. **Handler-scoped command spaces**
   - `commands.yaml` distinguishes legacy u8 commands, process-prefixed private
     commands, and handler-scoped u8 command sets.
3. **Transport and handshake layers**
   - Talos focused on decoded protocol tables; m2ir also models chunk framing
     and EC-SRP5 handshake structure.
4. **Field semantics**
   - The YAML carries roles, aliases, and tcodes, not just names.
5. **Known unknowns**
   - The schema preserves open questions programmatically instead of forcing the
     generator to silently guess.

That means a generated dissector could do more than "display a nicer label":
it could choose different decode paths, annotate uncertainty, and avoid false
confidence on version-sensitive ids.

## Where the current schema still falls short

The missing pieces are substantive and explain why "yes, feasible" is not the
same as "yes, complete":

### 1. Handler-private coverage is still thin

The generated shape currently only has a tiny documented slice of the
handler-private world:

- 2 process-prefixed commands from `mepty`
- 2 handler-scoped `mproxy` file-transfer commands
- 4 legacy short-form commands

That is enough to prove generation works, but not enough to claim broad command
coverage across WinBox IPC.

### 2. User-namespace fields are not broadly cataloged yet

A Wireshark dissector gets much more useful when application payload keys in the
user namespace are named. The current schema has strong `SYS_*` and `STD_*`
coverage, but the per-handler user fields remain sparse.

### 3. Process ids are intentionally not flattened into one universal table

This is a strength of the schema, but it complicates generation.

A real dissector would need one of these strategies:

1. show a reference-version label only,
2. show a version-qualified label when known, or
3. surface uncertainty when the schema records a conflict.

That is still possible to automate, but it is not the same as generating one naive
`value_string` array.

### 4. Many command argument / response schemas are still partial

The current schema can already generate command-space tables, but it cannot yet
generate rich per-command subtree decoders for most handlers because the field
catalogs are still incomplete.

## Practical conclusion

The experiment says the scheme passes the important test:

> **m2ir already captures enough structured, machine-readable information to
> generate dissector data automatically from schema files, without further
> research.**

More specifically:

- **Yes**, we can generate the non-plumbing data structures a Wireshark
  dissector would need.
- **Yes**, that generated data can already exceed the drained Cisco-Talos
  baseline in scope and fidelity.
- **No**, the current schema is not yet complete enough to auto-generate a
  broadly complete WinBox dissector across all handlers.

So the current limitation is **coverage depth**, not schema shape.

## Best next step if we ever want to push further

If this grows beyond a thought experiment, the best next increment is not
Wireshark-specific code. It is more schema drain work in the same format:

1. expand handler-private command catalogs,
2. add more user-namespace field maps per handler family,
3. keep process / handler identity version-scoped rather than flattening it,
4. add fixture-backed examples for command arguments and replies.

Once those land, a generator like `winbox-dissector-shape.ts` could emit either
Lua tables for Wireshark or some other decode-oriented intermediate format with
very little additional design work.

## Follow-up source check: `tikoci/mikrotik-gpl`

I also checked the GPL kernel drop in
[`tikoci/mikrotik-gpl`](https://github.com/tikoci/mikrotik-gpl) as a possible
source of missing WinBox clues such as process names or numeric ids.

<!-- cspell:words Kconfig bootinfo -->

### Result

Useful for **hardware/platform naming** and kernel support details.

Not useful, at least in the current drop, for **WinBox IPC process ids,
`system.x3`, `/nova/bin/*`, or handler catalogs**.

### Why

The repo README explicitly says the useful disclosed part is mainly the Linux
kernel, while most RouterOS user space remains proprietary. That matches what
the kernel tree actually contains.

Concrete examples from the checked tree:

- `arch/mips/Kconfig` adds support for the **Mikrotik RouterBoard 532** series.
- `arch/mips/include/asm/bootinfo.h` defines machine types
  `MACH_MIKROTIK_RB532` and `MACH_MIKROTIK_RB532A`.
- `drivers/spi/spi-rb4xx.c` is a **RouterBoard 4xx SPI controller driver**
  based on patches MikroTik published for those boards.

By contrast, targeted searches in the checked `linux-5.6.3` tree for WinBox /
RouterOS user-space markers found **no hits** for:

- `mepty`
- `mproxy`
- `system.x3`
- `/nova/bin`
- `WinBox`
- `routeros`

### Interpretation for m2ir

This GPL source looks like a **kernel/platform source**, not a RouterOS IPC or
WinBox user-space source. So it is unlikely to help with the specific open
questions we still have around:

1. process ids for WinBox-facing daemons,
2. handler registration tables,
3. `SYS_CMD` handler-private command spaces, or
4. user-namespace field catalogs.

It may still be worth keeping in mind for adjacent work:

- RouterBoard family naming and machine identifiers
- hardware driver provenance
- kernel config and platform support deltas between RouterOS drops

But for the WinBox IPC schema specifically, it looks like a **low-yield source
for process-id discovery** and a **high-yield source only for board/kernel
grounding**.
