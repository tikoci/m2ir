// cspell:ignore cls enm occ typevalue unmodeled yname
/**
 * Diff profiles/winbox-ipc/gui-handlers.yaml against router-served .jg descriptors.
 *
 *   bun jg-diff.ts <gui-handlers.yaml> <jg-root with one dir per version> <out.md>
 *
 * Classes per YAML field (matched on route + namespace + field number, every
 * dialog occurrence and every type letter kept):
 *   unknown-named  YAML calls it unknown-*, .jg names it
 *   agree          a .jg name contains / is contained in the YAML name
 *   name-differs   .jg names it differently (synonym, or a real conflict)
 *   jg-unnamed     .jg references it only as an unnamed sub-control
 *   yaml-only      no .jg dialog shows it (wire-only, or dialog not modeled)
 */
import { readFileSync, writeFileSync } from "node:fs";
import YAML from "yaml";
import { TCODE_LETTER } from "../../src/tooling/lint-yaml.ts";
import { type JgItem, type JgOcc, loadDir } from "./jg-parse.ts";

const [yamlPath, jgRoot, outPath, jsonPath] = process.argv.slice(2) as [
	string,
	string,
	string,
	string | undefined,
];
const VERSIONS = ["6.49.23", "7.25", "7.26beta4"];
const NS: Record<string, number> = { user: 0, "1": 1, session: 0xfe };

/**
 * Namespace-0 ids on a generic-template route collide across sub-dialogs
 * (interface f4 = Ageing Time on a bridge, something else on a VLAN).
 * Restrict those YAML groups to the dialog the YAML rows were observed on.
 */
const DIALOG_FILTER: Array<{ route: string; ns: number; dialog: RegExp }> = [
	{ route: "[20, 0]", ns: 0, dialog: /^Bridge typevalue=12$/ },
];

const jg = new Map(VERSIONS.map((v) => [v, loadDir(`${jgRoot}/${v}`)]));
const doc = YAML.parse(readFileSync(yamlPath, "utf8"));
const norm = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

function enumOf(v: unknown): string | undefined {
	const x = v as {
		type?: string;
		map?: Record<string, string>;
		path?: number[];
		values?: { type?: string; map?: Record<string, string>; path?: number[] };
	};
	if (!x) return undefined;
	const m = x.map ?? (x.values?.type === "static" ? x.values.map : undefined);
	if (m && typeof m === "object")
		return Object.entries(m)
			.map(([k, s]) => `${k}=${s}`)
			.join(", ");
	const path = x.type === "dynamic" ? x.path : x.values?.path;
	if (path) return `rows of ${JSON.stringify(path)}`;
	return x.type;
}

type Cls =
	| "type-differs"
	| "unknown-named"
	| "agree"
	| "name-differs"
	| "jg-unnamed"
	| "yaml-only";
type Row = {
	handler: string;
	route: string;
	ns: number;
	field: number;
	letter: string;
	yname: string;
	jg: string[];
	versions: string[];
	enm?: string;
	cls: Cls;
	/** Matching .jg occurrences (same type letter), for promotion tooling. */
	detail: Array<JgOcc & { id: string; version: string }>;
};

const rows: Row[] = [];
const modeled = new Set<string>();
for (const [handler, h] of Object.entries<Record<string, unknown>>(
	doc.handlers,
)) {
	const sysTo = h?.["sys-to"];
	const fields = h?.["fields"] as Record<string, unknown> | undefined;
	if (!Array.isArray(sysTo) || !fields) continue;
	const route = JSON.stringify(sysTo).replace(/,/g, ", ");
	modeled.add(route);
	const groups: Array<[number, Record<string, unknown>]> = [];
	for (const [k, v] of Object.entries(fields))
		if (k.startsWith("namespace-") && v && typeof v === "object")
			groups.push([NS[k.slice(10)] ?? -1, v as Record<string, unknown>]);
	if (typeof fields["namespace"] === "string" && fields["map"])
		groups.push([
			NS[fields["namespace"]] ?? -1,
			fields["map"] as Record<string, unknown>,
		]);
	const filter = DIALOG_FILTER.filter((d) => d.route === route);
	for (const [ns, map] of groups)
		for (const [fk, fv] of Object.entries(map)) {
			const field = Number(fk);
			if (!Number.isFinite(field)) continue;
			// Typed identity: a `variants:` entry yields one row per type letter.
			const entry = (fv ?? {}) as {
				name?: string;
				tcode?: string;
				variants?: Record<string, { name?: string; tcode?: string }>;
			};
			const typed: Array<[string, string]> = entry.variants
				? Object.entries(entry.variants).map(([l, v]) => [
						l,
						String(v?.name ?? ""),
					])
				: [[TCODE_LETTER[entry.tcode ?? ""] ?? "", String(entry.name ?? "")]];
			const keep = (o: JgOcc) =>
				filter.every((d) => d.ns !== ns || d.dialog.test(o.dialog));
			for (const [letter, yname] of typed) {
				const versions: string[] = [];
				const occ = new Map<string, string>();
				const otherType = new Set<string>();
				const detail: Row["detail"] = [];
				let enm: string | undefined;
				for (const v of VERSIONS) {
					const item = jg.get(v)?.get(route);
					const hits = item
						? [...item.fields.values()].filter(
								(f) => f.ns === ns && f.field === field,
							)
						: [];
					const sameType = hits.filter((f) => !letter || f.tchar === letter);
					for (const f of hits)
						if (letter && f.tchar !== letter && f.occ.some(keep))
							otherType.add(f.id);
					const os = sameType.flatMap((f) =>
						f.occ.filter(keep).map((o) => ({ ...o, id: f.id })),
					);
					if (!os.length) continue;
					versions.push(v);
					for (const o of os) {
						detail.push({ ...o, version: v });
						const where = `${o.dialog}${o.board ? ` [${o.board}]` : ""}`;
						const label = `${o.name ? `"${o.name}"` : "(unnamed)"} ${o.id}:${o.type} @ ${where}${o.nonpublic ? " (nonpublic)" : ""}`;
						occ.set(label, o.name);
						enm ??= enumOf(o.values);
					}
				}
				const names = [...new Set(occ.values())].filter(Boolean);
				const agrees = (n: string) =>
					norm(n) === norm(yname) ||
					norm(n).includes(norm(yname)) ||
					norm(yname).includes(norm(n));
				const cls: Cls = !versions.length
					? otherType.size
						? "type-differs"
						: "yaml-only"
					: !names.length
						? "jg-unnamed"
						: /^unknown-(f?\d+|bool|u8|empty)/i.test(yname)
							? "unknown-named"
							: names.some(agrees)
								? "agree"
								: "name-differs";
				rows.push({
					handler,
					route,
					ns,
					field,
					letter,
					yname,
					jg: versions.length
						? [...occ.keys()]
						: [...otherType].map((id) => `type ${id} only`),
					versions,
					enm,
					cls,
					detail,
				});
			}
		}
}

const unmodeled: JgItem[] = [];
let jgOnly = 0;
for (const [route, item] of jg.get("7.25") ?? []) {
	if (!modeled.has(route)) {
		unmodeled.push(item);
		continue;
	}
	for (const f of item.fields.values())
		if (
			[0, 1, 0xfe].includes(f.ns) &&
			// Typed identity: a YAML row covers only its own type letter
			// (U478 does not cover Q478); a row with no letter covers any.
			!rows.some(
				(r) =>
					r.route === route &&
					r.ns === f.ns &&
					r.field === f.field &&
					(!r.letter || r.letter === f.tchar),
			)
		)
			jgOnly++;
}

const esc = (s: string) => s.replaceAll("|", "\\|");
const count = (c: Cls) => rows.filter((r) => r.cls === c).length;
const CLASSES: Cls[] = [
	"type-differs",
	"unknown-named",
	"name-differs",
	"jg-unnamed",
	"yaml-only",
	"agree",
];
const sizes = VERSIONS.map((v) => {
	const m = jg.get(v);
	let n = 0;
	for (const i of m?.values() ?? []) n += i.fields.size;
	return `${v}: ${m?.size} routes / ${n} field ids`;
});
let out = `# .jg descriptors vs gui-handlers.yaml

<!-- Generated by jg-diff.ts; do not edit by hand. -->
<!-- cspell:disable -->

Snapshot generated ${new Date().toISOString().slice(0, 10)} from the gui-handlers.yaml of that day. Later handler changes are not reflected until jg-diff.ts is run again.

- .jg coverage: ${sizes.join("; ")}
- YAML: ${rows.length} fields on ${modeled.size} routes
- Classes: ${CLASSES.map((c) => `${c} ${count(c)}`).join(", ")}
- 7.25 .jg routes with no YAML handler: ${unmodeled.length}; .jg field ids on modeled routes with no YAML entry: ${jgOnly}
- Dialog filters: ${DIALOG_FILTER.map((d) => `${d.route} ns${d.ns} -> ${d.dialog.source}`).join("; ")}
`;
for (const c of CLASSES) {
	out += `\n## ${c}\n\n| handler | route | ns | field | type | YAML name | .jg occurrences | versions | values |\n|---|---|---|---|---|---|---|---|---|\n`;
	for (const r of rows.filter((x) => x.cls === c))
		out += `| ${r.handler} | ${r.route} | ${r.ns.toString(16)} | ${r.field} | ${r.letter || "?"} | ${esc(r.yname)} | ${esc(r.jg.join("<br>"))} | ${r.versions.join(", ")} | ${esc(r.enm ?? "")} |\n`;
}
out += `\n## 7.25 routes with no YAML handler\n\n| route | file | first dialog | field ids |\n|---|---|---|---|\n`;
for (const it of unmodeled.sort((a, b) => a.route.localeCompare(b.route)))
	out += `| ${it.route} | ${it.file} | ${esc(it.dialogs[0] ?? "")} | ${it.fields.size} |\n`;
writeFileSync(outPath, out);
if (jsonPath) writeFileSync(jsonPath, JSON.stringify(rows, null, 1));
console.log(out.split("\n").slice(4, 9).join("\n"));
