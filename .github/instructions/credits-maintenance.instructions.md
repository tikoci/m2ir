---
applyTo: "CREDITS.md"
---

# Credits maintenance

[`CREDITS.md`](../../CREDITS.md) is the project-level index of upstream
sources whose data was drained into the schema. Update it when a *new
major source* enters the repo — not for every web citation.

## When to add a section

Add a `### [Project / repo name](url)` section to `CREDITS.md` when:

- A repo's code, tables, or text are drained into one or more `*.yaml`
  files under `physical/`, `concepts/`, or `profiles/`, AND
- The schema accumulates more than a handful of `evidence:` entries
  pointing at that source (rule of thumb: 5+ across the repo, or a
  whole `source-table:` block dedicated to it).

Two or three loose blog-post citations are NOT a major source. They stay
inside per-field `evidence:` blocks. The schema is the bibliography;
`CREDITS.md` is the contributor index.

## What each section should contain

- The project name and a single link (repo URL preferred; vendor docs
  URL acceptable when there is no repo).
- One or two sentences on *what* was drained from it and *which*
  profile/physical files it lands in.
- The source's license if known and not already obvious from the link
  (e.g. BSD-3-Clause, MIT, CC-BY).

Keep each section short. Per-field, per-line citations live in the
schema YAMLs (`evidence:`, `source-table:`, `revision-history:`); this
file does not duplicate them.

## When to revise an existing section

- The drained scope grew substantially (new tables, new profile).
- The upstream repo moved or was renamed.
- The contribution was superseded — note the supersession; do not
  delete attribution. Wrong prior beliefs in m2ir become
  `revision-history:` entries inside the schema, and the upstream that
  led to them stays credited.

## What NOT to do

- Do not turn `CREDITS.md` into a link farm of every Mikrotik forum
  post. Those go in `evidence:` blocks at field scope.
- Do not remove a credit because the data is now considered shaky;
  revise the schema's `confidence:` instead.
- Do not duplicate attribution information that already lives in the
  schema's `evidence:` URLs — `CREDITS.md` is a summary index, not a
  mirror.
