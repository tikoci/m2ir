// cspell:ignore getcmd occ typevalue nonpublic
/**
 * Index RouterOS .jg UI descriptors by M2 route.
 *
 *   bun jg-parse.ts <dir of .jg files> ["[20, 0]"]
 *
 * A node with `path:[sys, handler]` and a `type` (item, map, action,
 * statusbar, ...) is a dialog bound to that M2 route. A node with
 * `generic:'iface'` defines a template; nodes with `inherit:'iface'` and no
 * path are sub-dialogs on the template's route, distinguished by `typevalue`
 * (the interface type-code). `values:{type:'dynamic',path}` is an enum fed
 * from another route, not a dialog, so it is skipped.
 *
 * Field ids are one type letter plus hex: `u10006` = u32, namespace 0x01,
 * field 6. The same number can carry two types (`u10` and `s10`), so the
 * index keys on the full id and keeps every dialog occurrence.
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseLiteral } from "./jg-literal.ts";

export type JgOcc = {
	name: string;
	type: string;
	dialog: string;
	board: string;
	file: string;
	values?: unknown;
	nonpublic: boolean;
	ro: boolean;
	/** inv:1 — the client shows the inverse of a bool field. */
	inv: boolean;
};
export type JgField = {
	id: string;
	tchar: string;
	ns: number;
	field: number;
	occ: JgOcc[];
};
export type JgItem = {
	route: string;
	file: string;
	dialogs: string[];
	fields: Map<string, JgField>;
};

type Node = Record<string, unknown>;
type Ctx = { item: JgItem; dialog: string; board: string; ro: boolean };

export function parseId(
	id: string,
): { tchar: string; ns: number; field: number } | null {
	const m = /^([a-zA-Z])([0-9a-fA-F]+)$/.exec(id);
	if (!m?.[1] || !m[2]) return null;
	const v = Number.parseInt(m[2], 16);
	return { tchar: m[1], ns: v >>> 16, field: v & 0xffff };
}

function boardOf(pred: unknown): string {
	const p = pred as { type?: string; value?: string; pred?: Node } | undefined;
	if (!p) return "";
	if (p.type === "board") return `board=${p.value}`;
	if (p.type === "not" && p.pred?.["type"] === "board")
		return `board!=${String(p.pred["value"])}`;
	return JSON.stringify(p).includes('"board"') ? "board-cond" : "";
}

const isNode = (v: unknown): v is Node =>
	typeof v === "object" && v !== null && !Array.isArray(v);
const isRoute = (v: unknown): v is number[] =>
	Array.isArray(v) && v.every((x) => typeof x === "number");

export function loadDir(dir: string): Map<string, JgItem> {
	const items = new Map<string, JgItem>();
	const files = readdirSync(dir)
		.filter((x) => x.endsWith(".jg"))
		.sort();
	const trees = files.map(
		(f) => [f, parseLiteral(readFileSync(join(dir, f), "utf8"))] as const,
	);

	const generics = new Map<string, number[]>();
	const scan = (n: unknown): void => {
		if (Array.isArray(n)) {
			for (const x of n) scan(x);
			return;
		}
		if (!isNode(n)) return;
		if (typeof n["generic"] === "string" && isRoute(n["path"]))
			generics.set(n["generic"], n["path"]);
		for (const v of Object.values(n)) scan(v);
	};
	for (const [, t] of trees) scan(t);

	for (const [f, tree] of trees) {
		const file = basename(f);
		const walk = (raw: unknown, ctx: Ctx | null): void => {
			if (Array.isArray(raw)) {
				for (const n of raw) walk(n, ctx);
				return;
			}
			if (!isNode(raw)) return;
			let node = raw;
			const inherit = node["inherit"];
			if (
				!node["path"] &&
				node["type"] &&
				typeof inherit === "string" &&
				generics.has(inherit)
			) {
				const tv = node["typevalue"];
				node = {
					...node,
					path: generics.get(inherit),
					title: `${String(node["title"] ?? node["name"] ?? "")}${tv !== undefined ? ` typevalue=${tv}` : ""}`,
				};
			}
			let here = ctx;
			const path = node["path"];
			if (isRoute(path) && node["type"] && node["type"] !== "dynamic") {
				const route = JSON.stringify(path).replace(/,/g, ", ");
				const item = items.get(route) ?? {
					route,
					file,
					dialogs: [],
					fields: new Map<string, JgField>(),
				};
				items.set(route, item);
				const dialog = String(node["title"] ?? node["name"] ?? node["type"]);
				const board = boardOf(node["pred"]);
				const getcmd =
					node["getcmd"] !== undefined ? `, getcmd=${node["getcmd"]}` : "";
				item.dialogs.push(
					`${dialog} (${String(node["type"])}${board ? `, ${board}` : ""}${getcmd}) @${file}`,
				);
				here = { item, dialog, board, ro: !!node["ro"] };
			}
			const id = node["id"];
			const parsed = typeof id === "string" ? parseId(id) : null;
			if (here && typeof id === "string" && parsed) {
				const fl = here.item.fields.get(id) ?? { id, ...parsed, occ: [] };
				here.item.fields.set(id, fl);
				fl.occ.push({
					name: String(node["name"] ?? ""),
					type: String(node["type"] ?? ""),
					dialog: here.dialog,
					board: here.board,
					file,
					values: node["values"],
					nonpublic: !!node["nonpublic"],
					inv: !!node["inv"],
					ro: here.ro || !!node["ro"],
				});
			}
			for (const [k, v] of Object.entries(node))
				if (k !== "path" && k !== "values") walk(v, here);
		};
		walk(tree, null);
	}
	return items;
}

if (import.meta.main) {
	const [dir, want] = process.argv.slice(2);
	if (!dir) {
		console.error('usage: bun jg-parse.ts <dir> ["[20, 0]"]');
		process.exit(2);
	}
	const items = loadDir(dir);
	let n = 0;
	for (const it of items.values()) n += it.fields.size;
	console.log(`${items.size} routes, ${n} field ids`);
	const it = want ? items.get(want) : undefined;
	if (it) {
		console.log(it.dialogs.join("\n"));
		for (const f of it.fields.values())
			console.log(
				` ${f.id} ns${f.ns.toString(16)} f${f.field}`,
				f.occ
					.map(
						(o) =>
							`${JSON.stringify(o.name)}:${o.type} @ ${o.dialog}${o.board ? ` [${o.board}]` : ""}`,
					)
					.join(" | "),
			);
	}
}
