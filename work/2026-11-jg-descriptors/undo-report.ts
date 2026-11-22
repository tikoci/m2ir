// cspell:ignore restraml occ enm Kib Mib Gib sfd002a
/**
 * Offline report for the [17] undo-history oracle (plan step 4b, q4/q5).
 *
 *   bun undo-report.ts <oracle-dir> --jg <jg dir for the same version> \
 *     --deep-inspect <file> --out <report.md> [--json <mapping.json>]
 *
 * Input: writes.jsonl + meta.json from undo-oracle.ts. For each no-op
 * SET of one CLI property, the typed keys in that row's m1 (minus SYS_*
 * keys, the row id and keys every SET of the menu carries) are the
 * property's keys: mapping by isolation. Each key is then checked by
 * value against the CLI text in S9 (encodings below). Full records (the
 * remove inverse m2 + Sa, and /snmp's SET inverse) are also matched by
 * value alone, to show what name-by-value matching gets without
 * isolation. Each mapped key is compared with the .jg field on the same
 * route (id, type letter, name) and with gui-handlers.yaml.
 *
 * Values of SECRET_ARG properties are never printed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import YAML from "yaml";
import { nameTables } from "../2026-11-winbox-attributes/harness/schema-names.ts";
import { type JgItem, loadDir, parseId } from "./jg-parse.ts";
import { cliMenus, SECRET_ARG } from "./undo-menus.ts";
import type { LetterMsg, LetterValue } from "./webfig/m2-letters.ts";

const argv = process.argv.slice(2);
const opt = (n: string) => {
	const i = argv.indexOf(n);
	return i >= 0 ? argv[i + 1] : undefined;
};
const dir = argv[0];
const jgDir = opt("--jg");
const di = opt("--deep-inspect");
const outPath = opt("--out");
const jsonPath = opt("--json");
if (!dir || !jgDir || !di || !outPath) {
	console.error(
		"usage: undo-report.ts <oracle-dir> --jg <dir> --deep-inspect <file> --out <md> [--json <file>]",
	);
	process.exit(2);
}

type Write = {
	menu: string;
	how: "singleton" | "row" | "add";
	step: string;
	arg?: string;
	value?: string;
	ok: boolean;
	rows: LetterMsg[];
};
const meta = JSON.parse(readFileSync(`${dir}/meta.json`, "utf8")) as {
	machine: string;
	routeros_version: string;
};
const writes = readFileSync(`${dir}/writes.jsonl`, "utf8")
	.trim()
	.split("\n")
	.map((l) => JSON.parse(l) as Write);
const menus = cliMenus(di);
const jg = loadDir(jgDir);

// ── helpers ────────────────────────────────────────────────────────────

/** SYS_* keys are 0xff00xx (letter + "ff00xx"); 0x0000ff is an ordinary field. */
const isSys = (k: string) => /^[a-zA-Z]ff[0-9a-f]{4}$/.test(k);
/** Standard (0xfe) keys: std-keys.yaml, not per-dialog .jg fields. */
const isStd = (k: string) => /^[a-zA-Z]fe[0-9a-f]{4}$/.test(k);
const routeStr = (r: unknown) =>
	Array.isArray(r) ? `[${(r as number[]).join(", ")}]` : String(r);
const CMD = new Map<number, string>([
	[0xfe0003, "SETOBJ"],
	[0xfe0005, "ADDOBJ"],
	[0xfe0006, "REMOVEOBJ"],
	[0xfe000e, "SET"],
]);

/** CLI text "path verb [*id] a=b c="d e"" -> property map. */
export function parseCli(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of text.matchAll(/([a-z0-9.-]+)=("(?:[^"\\]|\\.)*"|\S*)/g)) {
		const raw = m[2] ?? "";
		// S9 can join several commands with "; ".
		out[m[1] as string] = raw.startsWith('"')
			? raw.slice(1, -1).replace(/\\(.)/g, "$1")
			: raw.replace(/;$/, "");
	}
	return out;
}

function ipv4Le(s: string): number | null {
	const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
	if (!m) return null;
	const b = m.slice(1, 5).map(Number);
	if (b.some((x) => x > 255)) return null;
	return (
		((b[0] as number) |
			((b[1] as number) << 8) |
			((b[2] as number) << 16) |
			((b[3] as number) << 24)) >>>
		0
	);
}
function ipv6Bytes(s: string): number[] | null {
	if (!s.includes(":")) return null;
	const [head, tail] = s.split("::") as [string, string | undefined];
	const h = head ? head.split(":") : [];
	const t = tail ? tail.split(":") : [];
	if (tail === undefined && h.length !== 8) return null;
	const words = [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
	if (words.length !== 8 || words.some((w) => !/^[0-9a-f]{1,4}$/i.test(w)))
		return null;
	return words.flatMap((w) => {
		const n = Number.parseInt(w, 16);
		return [n >> 8, n & 0xff];
	});
}
function durationSec(s: string): number | null {
	const m =
		/^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+)s)?(?:(\d+)ms)?$/.exec(
			s,
		);
	if (m && s !== "") {
		const [w, d, h, mi, se, ms] = m
			.slice(1)
			.map((x) => Number(x ?? 0)) as number[];
		return (
			((((w as number) * 7 + (d as number)) * 24 + (h as number)) * 60 +
				(mi as number)) *
				60 +
			(se as number) +
			(ms as number) / 1000
		);
	}
	const c = /^(\d+):(\d\d):(\d\d)$/.exec(s);
	if (c) return Number(c[1]) * 3600 + Number(c[2]) * 60 + Number(c[3]);
	return null;
}
function rate(s: string): number | null {
	const m = /^(\d+)([kMG]?)$/.exec(s);
	if (!m) return null;
	return (
		Number(m[1]) * ({ "": 1, k: 1e3, M: 1e6, G: 1e9 }[m[2] as string] ?? 1)
	);
}

type Candidate = { enc: string; val: LetterValue };
/** Encodings a CLI value may take on the wire, most specific first. */
export function candidates(v: string): Candidate[] {
	const c: Candidate[] = [];
	if (v === "yes" || v === "true") c.push({ enc: "bool", val: true });
	if (v === "no" || v === "false") c.push({ enc: "bool", val: false });
	if (/^\d+$/.test(v)) c.push({ enc: "number", val: Number(v) });
	if (/^0x[0-9a-f]+$/i.test(v)) c.push({ enc: "hex-number", val: Number(v) });
	const unit = /^(\d+(?:\.\d+)?)(KiB|MiB|GiB)$/.exec(v);
	if (unit) {
		const n = Number(unit[1]);
		const mul =
			{ KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 }[unit[2] as string] ?? 1;
		c.push({ enc: `size in ${unit[2]}`, val: n });
		c.push({
			enc: `size with unit ${unit[2]}, in bytes`,
			val: Math.round(n * mul),
		});
	}
	if (/^\d+\.\d+$/.test(v))
		c.push({ enc: "decimal, x1000", val: Math.round(Number(v) * 1000) });
	const date = /^(\d{4})-(\d\d)-(\d\d)$/.exec(v);
	if (date)
		c.push({
			enc: "date as Unix time (UTC midnight)",
			val:
				Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3])) / 1000,
		});
	const d = durationSec(v);
	if (d !== null && !/^\d+$/.test(v)) {
		c.push({ enc: "interval, seconds", val: d });
		c.push({ enc: "interval, milliseconds", val: Math.round(d * 1000) });
		c.push({ enc: "interval, centiseconds", val: Math.round(d * 100) });
	}
	const ip = ipv4Le(v);
	if (ip !== null) c.push({ enc: "IPv4 as u32 LE", val: ip });
	const pfx = /^([\d.]+)\/(\d+)$/.exec(v);
	if (pfx) {
		const a = ipv4Le(pfx[1] as string);
		const n = Number(pfx[2]);
		if (a !== null) {
			c.push({ enc: "IPv4 prefix: address u32 LE", val: a });
			c.push({ enc: "IPv4 prefix: length", val: n });
			const mask = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0;
			const le =
				(((mask >>> 24) & 0xff) |
					(((mask >>> 16) & 0xff) << 8) |
					(((mask >>> 8) & 0xff) << 16) |
					((mask & 0xff) << 24)) >>>
				0;
			c.push({ enc: "IPv4 prefix: netmask u32 LE", val: le });
		}
	}
	const range = /^([\d.]+)-([\d.]+)$/.exec(v);
	if (range) {
		const a = ipv4Le(range[1] as string);
		const b = ipv4Le(range[2] as string);
		if (a !== null) c.push({ enc: "IPv4 range: start u32 LE", val: a });
		if (b !== null) c.push({ enc: "IPv4 range: end u32 LE", val: b });
		if (a !== null && b !== null)
			c.push({ enc: "IPv4 range as [start, end] u32 LE", val: [a, b] });
	}
	const v6 = /^([0-9a-f:]+)(?:\/(\d+))?$/i.exec(v);
	if (v6) {
		const bytes = ipv6Bytes(v6[1] as string);
		if (bytes) {
			c.push({ enc: "IPv6 as 16 bytes", val: bytes });
			if (v6[2]) c.push({ enc: "IPv6 prefix: length", val: Number(v6[2]) });
		}
	}
	const mac = /^([0-9A-F]{2}(?::[0-9A-F]{2}){5})$/i.exec(v);
	if (mac)
		c.push({
			enc: "MAC as 6 bytes",
			val: v.split(":").map((x) => Number.parseInt(x, 16)),
		});
	const rl = /^([\dkMG]+)\/([\dkMG]+)$/.exec(v);
	if (rl) {
		const up = rate(rl[1] as string);
		const down = rate(rl[2] as string);
		if (up !== null) c.push({ enc: "rate pair: first, bits/s", val: up });
		if (down !== null) c.push({ enc: "rate pair: second, bits/s", val: down });
	}
	const hp = /^([\d.]+):(\d+)$/.exec(v);
	if (hp) {
		const a = ipv4Le(hp[1] as string);
		if (a !== null) c.push({ enc: "address:port: address u32 LE", val: a });
		c.push({ enc: "address:port: port", val: Number(hp[2]) });
	}
	// a/b pairs (rates, times, priorities): each half on its own key.
	const pair = /^([^/,]+)\/([^/,]+)$/.exec(v);
	if (pair && !v.includes(":") && !/^[\d.]+\/\d+$/.test(v))
		for (const [i, part] of [pair[1], pair[2]].entries())
			for (const x of candidates(part as string))
				if (x.enc !== "string")
					c.push({
						enc: `pair ${i ? "second" : "first"}: ${x.enc}`,
						val: x.val,
					});
	if (/^\d+$/.test(v)) c.push({ enc: "number list", val: [Number(v)] });
	if (/^\d+(,\d+)+$/.test(v))
		c.push({ enc: "number list", val: v.split(",").map(Number) });
	if (v === "") {
		c.push({ enc: "empty list", val: [] });
		c.push({ enc: "empty set = 0", val: 0 });
	}
	if (v.includes(",")) c.push({ enc: "string list", val: v.split(",") });
	c.push({ enc: "string", val: v });
	return c;
}
const same = (a: unknown, b: unknown) =>
	JSON.stringify(a) === JSON.stringify(b);
/** Non-SYS scalar and array values inside a message or message list. */
function nestedValues(v: unknown): unknown[] {
	if (Array.isArray(v))
		return v.flatMap((x) =>
			typeof x === "object" && x !== null && !Array.isArray(x)
				? nestedValues(x)
				: [],
		);
	if (typeof v !== "object" || v === null) return [];
	return Object.entries(v as LetterMsg)
		.filter(([k]) => !isSys(k))
		.flatMap(([, x]) =>
			typeof x === "object" && x !== null && !Array.isArray(x)
				? nestedValues(x)
				: [x],
		);
}

const norm = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
/** Loose name agreement between a .jg label and a CLI property name. */
function namesAgree(jgName: string, cli: string): boolean {
	const a = norm(jgName);
	const b = norm(cli);
	if (!a || !b) return false;
	if (a === b || a.includes(b) || b.includes(a)) return true;
	const ta = new Set(a.split(" "));
	const tb = b.split(" ");
	const hits = tb.filter(
		(t) => ta.has(t) || [...ta].some((x) => x.startsWith(t) || t.startsWith(x)),
	);
	return hits.length >= Math.ceil(tb.length / 2);
}

// ── gui-handlers routes ───────────────────────────────────────────────

const gh = YAML.parse(
	readFileSync(
		new URL("../../profiles/winbox-ipc/gui-handlers.yaml", import.meta.url),
		"utf8",
	),
) as { handlers?: Record<string, { "sys-to"?: unknown }> };
const ghByRoute = new Map<string, string>();
for (const [name, h] of Object.entries(gh.handlers ?? {})) {
	const st = h?.["sys-to"];
	if (Array.isArray(st) && st.every((x) => typeof x === "number"))
		ghByRoute.set(routeStr(st), name);
}
const ghRouteNames = nameTables().routes;
function ghFieldName(route: string, key: string): string | undefined {
	const p = parseId(key);
	if (!p) return undefined;
	const full = (p.ns << 16) | p.field;
	return ghRouteNames.get(route.slice(1, -1).replace(/ /g, ""))?.get(full)
		?.name;
}

// ── per-write isolation ───────────────────────────────────────────────

type KeyCheck = {
	key: string;
	value: LetterValue;
	enc: string;
	/** value: an encoding of the CLI text equals the key; explained: enum, reference, keyword, nested. */
	check: "value" | "explained" | "unconfirmed";
	jg?: {
		id: string;
		name: string;
		type: string;
		agree: "agree" | "type-differs";
	};
	jgName?: boolean;
	gh?: string;
};
type PropMap = {
	menu: string;
	route: string;
	cmd: string;
	arg: string;
	cliValue: string;
	secret: boolean;
	keys: KeyCheck[];
	note?: string;
};

const byMenu = new Map<string, Write[]>();
for (const w of writes) byMenu.set(w.menu, [...(byMenu.get(w.menu) ?? []), w]);

const userKeys = (m: LetterMsg | undefined) =>
	Object.keys(m ?? {}).filter((k) => !isSys(k) && k !== "ufe0001");
const rowFor = (w: Write) => {
	const rows = w.rows.filter(
		(r) => Array.isArray(r["S9"]) && (r["S9"] as string[]).length,
	);
	return (
		(w.arg
			? rows.find((r) => (r["S9"] as string[])[0]?.includes(` ${w.arg}=`))
			: undefined) ?? rows[0]
	);
};

function jgCheck(item: JgItem | undefined, key: string) {
	if (!item) return undefined;
	const hit = item.fields.get(key);
	if (hit) {
		const o = hit.occ.find((x) => x.name) ?? hit.occ[0];
		return {
			id: key,
			name: o?.name ?? "",
			type: o?.type ?? "",
			agree: "agree" as const,
		};
	}
	const p = parseId(key);
	if (!p) return undefined;
	for (const f of item.fields.values())
		if (f.ns === p.ns && f.field === p.field) {
			const o = f.occ.find((x) => x.name) ?? f.occ[0];
			return {
				id: f.id,
				name: o?.name ?? "",
				type: o?.type ?? "",
				agree: "type-differs" as const,
			};
		}
	return undefined;
}

const props: PropMap[] = [];
const extrasByMenu = new Map<string, string[]>();
const routeOf = new Map<string, { route: string; cmds: Set<string> }>();
const records = new Map<
	string,
	{ keys: string[]; source: string; cli: Record<string, string>; m: LetterMsg }
>();
const noRow: string[] = [];

for (const [menu, ws] of byMenu) {
	const cli = menus.get(menu);
	const sets = ws.filter((w) => w.step.startsWith("set:") && w.ok);
	const setRows = sets.map(rowFor).filter((r): r is LetterMsg => !!r);
	// Keys carried by every SET of the menu (e.g. sfd002a) are not the property's.
	const extras =
		setRows.length >= 3
			? userKeys(setRows[0]?.["m1"] as LetterMsg).filter((k) =>
					setRows.every((r) => k in ((r["m1"] as LetterMsg) ?? {})),
				)
			: [];
	extrasByMenu.set(menu, extras);
	for (const w of ws) {
		const r = rowFor(w);
		if (!r) {
			if (w.ok) noRow.push(`${menu} ${w.step}`);
			continue;
		}
		const m1 = r["m1"] as LetterMsg;
		const route = routeStr(m1?.["Uff0001"]);
		const ro = routeOf.get(menu) ?? { route, cmds: new Set<string>() };
		ro.cmds.add(CMD.get(m1?.["uff0007"] as number) ?? String(m1?.["uff0007"]));
		routeOf.set(menu, ro);
		const m2 = r["m2"] as LetterMsg | undefined;
		// Full records: the remove's inverse ADDOBJ, and a SET inverse that
		// carries more keys than the SET wrote (/snmp).
		const sa = (r["Sa"] as string[] | undefined)?.[0];
		if (
			m2 &&
			sa &&
			(w.step === "remove" || userKeys(m2).length > userKeys(m1).length + 2)
		)
			records.set(menu, {
				keys: userKeys(m2),
				source: w.step === "remove" ? "remove inverse" : "SET inverse",
				cli: parseCli(sa),
				m: m2,
			});
		if (!w.arg) continue;
		const cliText = (r["S9"] as string[])[0] ?? "";
		const cliValue = parseCli(cliText)[w.arg] ?? w.value ?? "";
		const keys = userKeys(m1).filter((k) => !extras.includes(k));
		const item = jg.get(route);
		const completions = cli?.completions[w.arg] ?? [];
		const checks: KeyCheck[] = keys.map((k) => {
			const val = m1[k] as LetterValue;
			const hit = candidates(cliValue).find((c) => same(c.val, val));
			let enc = hit?.enc ?? "unconfirmed";
			const words = cliValue.split(",").filter(Boolean);
			if (
				!hit &&
				(val === 0xffffffff || same(val, [0xffffffff])) &&
				/^[a-z-]+$/.test(cliValue)
			)
				enc = `keyword: ${cliValue} = 0xFFFFFFFF`;
			else if (!hit && k[0] === "u" && typeof val === "number") {
				if (completions.includes(cliValue))
					enc = `enum or named object: ${cliValue} = ${val}`;
				else if (
					words.length > 1 &&
					words.every((x) => completions.includes(x))
				)
					enc = `enum set as bitmask: ${cliValue} = 0x${val.toString(16)}`;
				else if (/^[a-z]/i.test(cliValue))
					enc = `reference: ${cliValue} = ${val}`;
			} else if (!hit && k[0] === "b" && completions.includes(cliValue))
				enc = `enum or named object: ${cliValue} = ${val}`;
			else if (
				!hit &&
				(k[0] === "U" || k[0] === "M") &&
				Array.isArray(val) &&
				words.length &&
				words.every((x) => completions.includes(x) || /^[a-z]/i.test(x))
			)
				enc = `enum or reference list: ${cliValue} = ${JSON.stringify(val).slice(0, 30)}`;
			else if (!hit && (k[0] === "m" || k[0] === "M")) {
				const inner = nestedValues(val);
				const parts = candidates(cliValue).filter((c) =>
					inner.some((x) => same(x, c.val)),
				);
				if (parts.length)
					enc = `nested message: ${[...new Set(parts.map((x) => x.enc))].join(" + ")}`;
			}
			if (!hit && (k[0] === "U" || k[0] === "M") && cliValue === "")
				enc = "empty list";
			const j = jgCheck(item, k);
			return {
				key: k,
				value: SECRET_ARG.test(w.arg as string) ? "<redacted>" : val,
				enc,
				check: hit
					? "value"
					: enc === "unconfirmed"
						? "unconfirmed"
						: "explained",
				...(j ? { jg: j, jgName: namesAgree(j.name, w.arg as string) } : {}),
				...(ghFieldName(route, k) ? { gh: ghFieldName(route, k) } : {}),
			};
		});
		props.push({
			menu,
			route,
			cmd: CMD.get(m1?.["uff0007"] as number) ?? "",
			arg: w.arg,
			cliValue: SECRET_ARG.test(w.arg) ? "<redacted>" : cliValue,
			secret: SECRET_ARG.test(w.arg),
			keys: checks,
			...(keys.length === 0 ? { note: "no key written" } : {}),
		});
	}
}

// ── value-only matching on full records ───────────────────────────────

type ValueMatch = {
	unique: number;
	ambiguous: number;
	unmatched: number;
	agreeWithIsolation: number;
	disagree: string[];
};
const valueOnly = new Map<string, ValueMatch>();
for (const [menu, rec] of records) {
	const res: ValueMatch = {
		unique: 0,
		ambiguous: 0,
		unmatched: 0,
		agreeWithIsolation: 0,
		disagree: [],
	};
	for (const [arg, v] of Object.entries(rec.cli)) {
		const hits = rec.keys.filter((k) =>
			candidates(v).some((c) => same(c.val, rec.m[k])),
		);
		if (hits.length === 1) {
			res.unique++;
			const iso = props.find((p) => p.menu === menu && p.arg === arg);
			if (iso?.keys.some((k) => k.key === hits[0])) res.agreeWithIsolation++;
			else if (iso)
				res.disagree.push(
					`${arg}: value ${hits[0]}, isolation ${iso.keys.map((k) => k.key).join("+") || "-"}`,
				);
		} else if (hits.length > 1) res.ambiguous++;
		else res.unmatched++;
	}
	valueOnly.set(menu, res);
}

// ── .jg route-level counts (q5) ───────────────────────────────────────

type RouteCount = {
	route: string;
	menus: string[];
	std: number;
	agree: number;
	typeDiffers: number;
	oracleOnly: number;
	jgOnlyWritable: number;
	jgOnlyRo: number;
	nameAgree: number;
	nameDiffers: number;
	jgUnnamed: number;
	jgDialogs: string[];
	gh?: string;
};
const routeCounts = new Map<string, RouteCount>();
for (const [menu, ro] of routeOf) {
	const rc = routeCounts.get(ro.route) ?? {
		route: ro.route,
		menus: [],
		std: 0,
		agree: 0,
		typeDiffers: 0,
		oracleOnly: 0,
		jgOnlyWritable: 0,
		jgOnlyRo: 0,
		nameAgree: 0,
		nameDiffers: 0,
		jgUnnamed: 0,
		jgDialogs: [],
		...(ghByRoute.get(ro.route) ? { gh: ghByRoute.get(ro.route) } : {}),
	};
	rc.menus.push(menu);
	routeCounts.set(ro.route, rc);
}
for (const rc of routeCounts.values()) {
	const seen = new Set<string>();
	for (const p of props.filter((x) => x.route === rc.route))
		for (const k of p.keys) {
			if (seen.has(k.key)) continue;
			seen.add(k.key);
			if (!k.jg && isStd(k.key)) rc.std++;
			else if (!k.jg) rc.oracleOnly++;
			else if (k.jg.agree === "agree") rc.agree++;
			else rc.typeDiffers++;
			if (k.jg) {
				if (!k.jg.name) rc.jgUnnamed++;
				else if (k.jgName) rc.nameAgree++;
				else rc.nameDiffers++;
			}
		}
	const item = jg.get(rc.route);
	rc.jgDialogs = [...new Set(item?.meta.map((m) => m.title) ?? [])].slice(0, 6);
	const recKeys = new Set(
		[...records]
			.filter(([m]) => rc.menus.includes(m))
			.flatMap(([, r]) => r.keys),
	);
	for (const f of item?.fields.values() ?? []) {
		if (seen.has(f.id)) continue;
		if (f.occ.every((o) => o.ro)) rc.jgOnlyRo++;
		else rc.jgOnlyWritable++;
		void recKeys;
	}
}

// ── markdown ──────────────────────────────────────────────────────────

const md: string[] = [];
const esc = (s: string) => s.replace(/\|/g, "\\|");
const fmtVal = (v: LetterValue) => {
	const s = JSON.stringify(v);
	return s.length > 40 ? `${s.slice(0, 37)}...` : s;
};
const totalKeys = props.flatMap((p) => p.keys);
const encCounts = new Map<string, number>();
for (const k of totalKeys) {
	const e = k.enc.replace(/:.*$/, "");
	encCounts.set(e, (encCounts.get(e) ?? 0) + 1);
}
const uniqueProps = props.filter((p) => p.keys.length === 1).length;
const multiProps = props.filter((p) => p.keys.length > 1).length;
const noneProps = props.filter((p) => p.keys.length === 0).length;
const sum = (f: (r: RouteCount) => number) =>
	[...routeCounts.values()].reduce((n, r) => n + f(r), 0);

md.push(
	"# `[17]` undo-history oracle: CLI property to typed key",
	"",
	"<!-- cspell:disable -->",
	"",
	`Generated by [\`undo-report.ts\`](undo-report.ts) from an [\`undo-oracle.ts\`](undo-oracle.ts) run on RouterOS ${meta.routeros_version} (quickchr ${meta.machine}). Do not edit by hand. Method and findings: [README](README.md#17-undo-history-oracle-plan-step-4b).`,
	"",
	"Each row is one no-op SET of one CLI property over REST. The typed keys in the history row's `m1` (the native request the router built) belong to that property: mapping by isolation. `value check` says how the key's value relates to the CLI text in `S9`. `.jg` compares the key with the field the router's own UI descriptor declares on the same route.",
	"",
	"## Summary",
	"",
	"| Measure | Count |",
	"|---|---|",
	`| Menus | ${byMenu.size} |`,
	`| Routes | ${routeCounts.size} (${[...routeCounts.values()].filter((r) => r.gh).length} in gui-handlers.yaml) |`,
	`| CLI properties mapped by isolation | ${props.length}: ${uniqueProps} to one key, ${multiProps} to several, ${noneProps} to none |`,
	`| Writes with no history row | ${noRow.length} |`,
	`| Keys confirmed by value / explained (enum, reference, keyword, nested) / unconfirmed | ${totalKeys.filter((k) => k.check === "value").length} / ${totalKeys.filter((k) => k.check === "explained").length} / ${totalKeys.filter((k) => k.check === "unconfirmed").length} |`,
	`| .jg: same typed key on the route | ${sum((r) => r.agree)} |`,
	`| .jg: same field number, other type letter | ${sum((r) => r.typeDiffers)} |`,
	`| Standard 0xfe keys (std-keys.yaml; .jg uses its own controls) | ${sum((r) => r.std)} |`,
	`| Oracle only (not in .jg for the route) | ${sum((r) => r.oracleOnly)} |`,
	`| .jg only (route fields no write touched): writable / read-only | ${sum((r) => r.jgOnlyWritable)} / ${sum((r) => r.jgOnlyRo)} |`,
	`| .jg label agrees with the CLI name / differs / .jg control unnamed | ${sum((r) => r.nameAgree)} / ${sum((r) => r.nameDiffers)} / ${sum((r) => r.jgUnnamed)} |`,
	"",
	"Value encodings seen:",
	"",
	"| Encoding | Keys |",
	"|---|---|",
	...[...encCounts]
		.sort((a, b) => b[1] - a[1])
		.map(([e, n]) => `| ${e} | ${n} |`),
	"",
	"## Routes",
	"",
	"| Route | CLI menus | Commands | gui-handlers.yaml | .jg dialogs | .jg agree / type differs / oracle only / .jg only (rw, ro) |",
	"|---|---|---|---|---|---|",
);
for (const rc of [...routeCounts.values()].sort((a, b) =>
	a.route.localeCompare(b.route, "en", { numeric: true }),
)) {
	const cmds = [
		...new Set(rc.menus.flatMap((m) => [...(routeOf.get(m)?.cmds ?? [])])),
	].join(", ");
	md.push(
		`| \`${rc.route}\` | ${rc.menus.map((m) => `\`${m}\``).join(", ")} | ${cmds} | ${rc.gh ?? "-"} | ${esc(rc.jgDialogs.join("; ") || "-")} | ${rc.agree} / ${rc.typeDiffers} / ${rc.oracleOnly} / ${rc.jgOnlyWritable}, ${rc.jgOnlyRo} |`,
	);
}

md.push(
	"",
	"## Value-only matching on full records",
	"",
	"A remove's inverse (`Sa` CLI + `m2` ADDOBJ) and the `/snmp` SET inverse carry the whole record. Matching CLI names to keys by value alone, compared with isolation:",
	"",
	"| Menu | Record | Unique | Ambiguous | Unmatched | Unique and equal to isolation |",
	"|---|---|---|---|---|---|",
);
for (const [menu, v] of valueOnly)
	md.push(
		`| \`${menu}\` | ${records.get(menu)?.source} | ${v.unique} | ${v.ambiguous} | ${v.unmatched} | ${v.agreeWithIsolation} |`,
	);
const dis = [...valueOnly].flatMap(([m, v]) =>
	v.disagree.map((d) => `\`${m}\` ${d}`),
);
if (dis.length)
	md.push(
		"",
		"Value-only matches that differ from isolation:",
		"",
		...dis.map((d) => `- ${d}`),
	);

md.push("", "## Mappings", "");
for (const [menu, ws] of byMenu) {
	const ro = routeOf.get(menu);
	const extras = extrasByMenu.get(menu) ?? [];
	md.push(
		`### \`${menu}\` → \`${ro?.route ?? "?"}\` ${[...(ro?.cmds ?? [])].join(", ")}`,
		"",
	);
	if (extras.length)
		md.push(
			`Every SET also carries ${extras.map((k) => `\`${k}\``).join(", ")} (left out below).`,
			"",
		);
	const rec = records.get(menu);
	if (rec) {
		const mapped = new Set(
			props
				.filter((p) => p.menu === menu)
				.flatMap((p) => p.keys.map((k) => k.key)),
		);
		const rest = rec.keys.filter((k) => !mapped.has(k) && !extras.includes(k));
		if (rest.length)
			md.push(
				`Full record (${rec.source}) keys no write touched: ${rest.map((k) => `\`${k}\``).join(", ")}.`,
				"",
			);
	}
	md.push(
		"| CLI property | Typed key | Value | Value check | .jg | gui-handlers |",
		"|---|---|---|---|---|---|",
	);
	for (const p of props.filter((x) => x.menu === menu)) {
		if (!p.keys.length) {
			md.push(`| \`${p.arg}\` | - | - | ${p.note} | - | - |`);
			continue;
		}
		for (const k of p.keys) {
			const j = k.jg
				? `${k.jg.agree === "agree" ? "" : `**${k.jg.id}** `}${esc(k.jg.name)} (${k.jg.type})${k.jgName || !k.jg.name ? "" : " ≠ name"}`
				: isStd(k.key)
					? "std key"
					: "**not in .jg**";
			md.push(
				`| \`${p.arg}\` | \`${k.key}\` | ${p.secret ? "redacted" : `\`${esc(fmtVal(k.value))}\``} | ${esc(k.enc)} | ${j} | ${k.gh ?? "-"} |`,
			);
		}
	}
	const failed = ws.filter((w) => !w.ok).map((w) => w.step);
	if (failed.length) md.push("", `Rejected by REST: ${failed.join(", ")}.`);
	md.push("");
}
if (noRow.length)
	md.push(
		"## Writes without a history row",
		"",
		...noRow.map((s) => `- ${s}`),
		"",
	);
md.push("<!-- cspell:enable -->", "");
writeFileSync(outPath, md.join("\n"));
if (jsonPath)
	writeFileSync(
		jsonPath,
		`${JSON.stringify({ routeros_version: meta.routeros_version, props, routes: [...routeCounts.values()], valueOnly: Object.fromEntries(valueOnly) }, null, "\t")}\n`,
	);
console.log(
	`undo-report: ${props.length} properties, ${routeCounts.size} routes -> ${outPath}`,
);
