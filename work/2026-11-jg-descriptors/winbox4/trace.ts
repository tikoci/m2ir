/**
 * Plan step 5: read a Bridge workflow fixture as a trace.
 *
 *   bun trace.ts <fixture.json> [--route 16,2] [--session W] [--rows] [--list]
 *
 * One line per record: tMs, session, direction (-> request, <- reply or
 * unsolicited), route, command, the 0xfe000c word, then the non-SYS typed
 * keys as <letter><hex>=<value> with the schema name where one exists
 * (gui-handlers / std-keys via schema-names.ts) and "?" where none does.
 * --rows expands 0xfe0002 rows the same way. --list adds the Bridge Ports
 * display that list-model.ts rebuilds after each [16,2] event. Works on
 * the native and WinBox fixtures (entry form); marks print as they change.
 */
import { readFileSync } from "node:fs";
import { captureMessage } from "../../2026-11-winbox-attributes/harness/capture.ts";
import {
	resolveCommandName,
	resolveRouteField,
	typeLetter,
} from "../../2026-11-winbox-attributes/harness/schema-names.ts";
import { hexToBytes } from "../webfig/m2-letters.ts";
import { type ListEvent, ListView, type RowUpdate } from "./list-model.ts";

interface Entry {
	key: string;
	tcode: string;
	value: unknown;
}
interface Rec {
	id: string;
	mark: string;
	session: string;
	tMs: number;
	cmd: number | null;
	to: number[] | null;
	from: number[] | null;
	reqId: number | null;
	hex: string;
	entries: Entry[] | null;
}

const args = process.argv.slice(2);
const opt = (name: string) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find((a) => a.endsWith(".json"));
if (!file) {
	console.error(
		"usage: trace.ts <fixture.json> [--route 16,2] [--session W] [--rows] [--list]",
	);
	process.exit(2);
}
const routeFilter = opt("--route");
const sessionFilter = opt("--session");
const showRows = args.includes("--rows");
const showList = args.includes("--list");
const fx = JSON.parse(readFileSync(file, "utf8")) as { records: Rec[] };

const short = (v: unknown): string => {
	const s = JSON.stringify(v);
	return s.length > 40 ? `${s.slice(0, 37)}...` : s;
};
function keyText(route: number[], e: Entry): string {
	const k = Number.parseInt(e.key, 16);
	const t = Number.parseInt(e.tcode, 16);
	const r = resolveRouteField(route, k, t);
	const name = r.name ?? "?";
	return `${typeLetter(t)}${k.toString(16)}(${name})=${short(e.value)}`;
}
const view = new ListView();
const upd = (row: Entry[]): RowUpdate => {
	const v = (k: string) => row.find((e) => e.key === k)?.value;
	return {
		id: v("0xfe0001") as number,
		...(typeof v("0xfe0005") === "number"
			? { next: v("0xfe0005") as number }
			: {}),
		...(typeof v("0xfe0009") === "string"
			? { comment: v("0xfe0009") as string }
			: {}),
		...(v("0xfe0013") === 1 ? { removed: true } : {}),
	};
};
const asked = new Map<string, Rec>();
let mark = "";
for (const r of fx.records) {
	if (sessionFilter && r.session !== sessionFilter) continue;
	const tx =
		r.cmd !== null &&
		r.cmd !== 0xfe000b &&
		r.to !== null &&
		JSON.stringify(r.to) !== "[0,1]" &&
		!(r.to[0] === 0);
	const route = (tx ? r.to : r.from) ?? [];
	if (tx && r.reqId !== null) asked.set(`${r.session}/${r.reqId}`, r);
	const q =
		!tx && r.reqId !== null ? asked.get(`${r.session}/${r.reqId}`) : undefined;
	if (routeFilter && route.join(",") !== routeFilter) continue;
	if (r.mark !== mark) {
		mark = r.mark;
		console.log(`---- ${mark}`);
	}
	const cmd = tx ? r.cmd : r.cmd === 0xfe000b ? r.cmd : (q?.cmd ?? null);
	const cname =
		cmd === null
			? "-"
			: (resolveCommandName(cmd).name ?? `0x${cmd.toString(16)}`);
	const dir = tx ? "->" : r.cmd === 0xfe000b ? "<~" : "<-";
	// Large records keep hex only (entries: null): decode them here.
	const decoded = r.entries ? null : captureMessage(0, "rx", hexToBytes(r.hex));
	const entries =
		r.entries ??
		(decoded?.decode.ok ? (decoded.decode.entries as Entry[]) : []);
	const top = entries
		.filter((e) => !e.key.startsWith("0xff") && e.key !== "0xfe0002")
		.map((e) => keyText(route, e));
	const rows = entries.find((e) => e.key === "0xfe0002")?.value as
		| Entry[][]
		| undefined;
	console.log(
		`${r.tMs.toFixed(0).padStart(8)} ${r.session} ${dir} ${JSON.stringify(route)} ${cname}${rows ? ` rows=${rows.length}` : ""} ${top.join(" ")}`,
	);
	if (showRows && rows)
		for (const row of rows)
			console.log(
				`           row ${row.map((e) => keyText(route, e)).join(" ")}`,
			);
	if (showList && JSON.stringify(route) === "[16,2]" && rows && cmd !== null) {
		const word = q?.entries?.find((e) => e.key === "0xfe000c")?.value;
		const defaults = typeof word === "number" && (word & 0x20000000) !== 0;
		if (!defaults && (cmd === 0xfe000b || cmd === 0xfe0004)) {
			const ev: ListEvent = {
				tMs: r.tMs,
				kind: cmd === 0xfe000b ? "notify" : "list",
				rows: rows.map(upd),
				ref: r.id,
			};
			view.apply(ev);
			const d = view.display();
			console.log(
				`           shown ${d.ids.map((id, i) => `${id}:${d.comments[i]}`).join(" | ")}`,
			);
		}
	}
}
