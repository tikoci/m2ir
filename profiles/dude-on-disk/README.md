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
  Largest existing knowledge bank scheduled to be drained into m2ir.
- [`german77/TheDudeToHuman`](https://github.com/german77/TheDudeToHuman)
  — earlier, more battle-tested decoder. Donny absorbed much of its
  understanding, but TheDudeToHuman has more real-world testing miles;
  cross-check against it when donny and the schema disagree.

Placeholder. Populate after `winbox-ipc/` reaches v0.1.
