# profiles/dude-on-disk/

The Dude's per-row blob in `dude.db` `objs.obj`. Same physical grammar as
`winbox-ipc/`, but byte 2 is a `marker` (0x10/0x11/0xFE), compact length
is signaled by the marker byte itself, and object class is determined by
the *range* the leading section-1 tag falls into (Device, Group,
Network, …). Magic is the 8-byte preamble `4D 32 01 00 FF 88 01 00`.

Reference implementations:

- [`tikoci/donny`](https://github.com/tikoci/donny) — `src/lib/nova.ts`
  has the full TAG/RANGE catalog (~200 named tags, ~20 object classes),
  sentinels, foreign-key relationships, and curated superseded beliefs.
  The initial canonical drain below captures its class/tag catalogs;
  deeper behavior still needs per-entry evidence and cross-checks.
- [`german77/TheDudeToHuman`](https://github.com/german77/TheDudeToHuman)
  — earlier, more battle-tested decoder. Donny absorbed much of its
  understanding, but TheDudeToHuman has more real-world testing miles;
  cross-check against it when donny and the schema disagree.

Initial canonical drain now lives in:

- [`profile.yaml`](profile.yaml) — profile rules, marker semantics, continuation shape,
  and leading-tag range classification.
- [`object-classes.yaml`](object-classes.yaml) — the RANGE catalog from donny, with the
  overlapping note/service-description band called out explicitly.
- [`fields.yaml`](fields.yaml) — the TAG catalog keyed by `(object-class, tag)` so
  overlapping numeric tags stay distinct.

For a file-analysis task, read those YAML files in order and follow each
entry's evidence and confidence. This is an initial populated profile;
it does not claim complete field typing, a full database schema, or a
fixture corpus. New samples, corrections, and unknown tags are welcome
through the [discovery submission path](../../README.md#submit-a-discovery).
Use the [format and research index](../README.md) for related file formats.
