// cspell:ignore webfig quickchr omarchy
/**
 * Plan step 5: turn a proxy.ts capture (plus drive.ts marks and the [17]
 * history read) into the shared fixture
 * fixtures/winbox-ipc/<version>-winbox4-bridge-workflow.json.
 *
 *   bun fixture.ts <capture-dir> <out.json> [--entries-max <bytes>]
 *                  [--meta <provenance.json>] [--collapse-polls]
 *
 * --meta merges its keys over the provenance defaults (report, lab_rows,
 * control, ...), for runs other than the step 5 Bridge workflow.
 * --collapse-polls also drops the request of a timed read whose reply was
 * dropped as unchanged; provenance.poll_periods keeps the median period
 * per (session, route, command) from every request.
 *
 * Several WinBox connections (a reconnect) become sessions W1, W2, ...;
 * one connection stays session W. Proxy connection events (drop, close,
 * accept, login) go into provenance.connection_events.
 *
 * Kept: every message on [16,2] and [20,*] (the Bridge window), and the
 * first two messages per (route, direction, command) elsewhere, with the
 * dropped repeats counted per route in provenance. Dropped completely:
 * [2,2], the file transfer that downloads the router's .jg descriptors
 * (MikroTik's files; only their names go into provenance). Each record
 * carries mark (the last UI or driver mark before it), session "W" (the
 * WinBox connection) and tMs (ms since the WinBox login). The [17] row
 * for WinBox's own write is kept as history_winbox with the source
 * address redacted. No hosts, ports, credentials or capture wall-clock
 * time (the lab CHR's own clock rides in [24,*] replies).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { captureMessage } from "../../2026-11-winbox-attributes/harness/capture.ts";
import {
	decodeLetters,
	hexToBytes,
	type LetterMsg,
} from "../webfig/m2-letters.ts";

interface Entry {
	key: string;
	tcode: string;
	value: unknown;
}
interface Line {
	event?: string;
	conn?: number;
	seq?: number;
	dir?: "c2s" | "s2c";
	tag?: number;
	hex?: string;
	tMs: number;
	wallMs: number;
	[k: string]: unknown;
}

const CMD_NAME: Record<number, string> = {
	1: "CMD_1",
	5: "CMD_5",
	7: "CMD_7",
	16646145: "GETPOLICIES",
	16646146: "GETOBJ",
	16646147: "SETOBJ",
	16646148: "GETALL",
	16646149: "ADDOBJ",
	16646150: "REMOVEOBJ",
	16646151: "MOVEOBJ",
	16646155: "NOTIFY",
	16646157: "GET",
	16646162: "SUBSCRIBE",
	16646163: "UNSUBSCRIBE",
};

/**
 * A u64 from the capture ("u64:<decimal>", tcode 0x10 or inside a 0x90
 * array): a number when it is a safe integer, else the exact decimal
 * string. Decided by tcode, never by a string prefix alone.
 */
function u64Value(v: unknown): unknown {
	if (typeof v !== "string" || !v.startsWith("u64:")) return v;
	const dec = v.slice(4);
	const n = Number(dec);
	return Number.isSafeInteger(n) ? n : dec;
}
function fixValue(v: unknown): unknown {
	if (Array.isArray(v)) {
		if (
			v.length > 0 &&
			Array.isArray(v[0]) &&
			typeof (v[0] as unknown[])[0] === "object"
		)
			return (v as Entry[][]).map((row) => row.map(fixEntry));
		if (
			v.length > 0 &&
			typeof v[0] === "object" &&
			v[0] !== null &&
			"key" in v[0]
		)
			return (v as Entry[]).map(fixEntry);
		return v.map(fixValue);
	}
	return v;
}
function fixEntry(e: Entry): Entry {
	const t = Number.parseInt(e.tcode, 16);
	const value =
		t === 0x10
			? u64Value(e.value)
			: t === 0x90 && Array.isArray(e.value)
				? e.value.map(u64Value)
				: fixValue(e.value);
	return { key: e.key, tcode: e.tcode, value };
}

const args = process.argv.slice(2);
let entriesMax = 256;
let metaPath = "";
let collapsePolls = false;
const pos: string[] = [];
for (let i = 0; i < args.length; i++) {
	const a = args[i] ?? "";
	if (a === "--entries-max") entriesMax = Number(args[++i]);
	else if (a === "--meta") metaPath = args[++i] ?? "";
	else if (a === "--collapse-polls") collapsePolls = true;
	else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
	else pos.push(a);
}
const [dir, out] = pos;
if (!dir || !out) {
	console.error(
		"usage: fixture.ts <capture-dir> <out.json> [--entries-max <bytes>] [--meta <json>] [--collapse-polls]",
	);
	process.exit(2);
}
/** JSONL reader; a parse error names the file and line. */
const readJsonl = <T>(p: string): T[] =>
	readFileSync(p, "utf8")
		.trim()
		.split("\n")
		.map((l, i) => {
			try {
				return JSON.parse(l) as T;
			} catch (e) {
				throw new Error(`${p} line ${i + 1}: ${(e as Error).message}`);
			}
		});
const cap = readJsonl<Line>(`${dir}/capture.jsonl`);
const marks = readJsonl<{
	wallMs: number;
	mark?: string;
	action?: string;
	[k: string]: unknown;
}>(`${dir}/marks.jsonl`);
const start = cap.find((l) => l.event === "proxy-start");
const logins = cap.filter((l) => l.event === "phase2" && l["ok"] === true);
const login = logins[0];
if (!start || !login)
	throw new Error("capture has no proxy-start or successful login");
const conns = new Set(logins.map((l) => l.conn));
const sessionOf = (c: number | undefined) => (conns.size === 1 ? "W" : `W${c}`);
const t0 = login.wallMs;
const rel = (w: number) => Math.round((w - t0) * 10) / 10;

// Timeline: UI marks and driver actions, relative to the login.
const timeline = marks.map((m) => {
	const { wallMs, ...rest } = m;
	return { tMs: rel(wallMs), ...rest };
});
const markAt = (wallMs: number): string => {
	let cur = "login";
	for (const m of marks) {
		if (m.wallMs > wallMs) break;
		const label = m.mark ?? (m.action ? `action:${m.action}` : undefined);
		if (label) cur = label;
	}
	return cur;
};

const pathKey = (p: number[] | null) => JSON.stringify(p);
const isBridge = (p: number[] | null) =>
	p !== null && (pathKey(p) === "[16,2]" || p[0] === 20);
const seen = new Map<string, number>();
const dropped: Record<string, number> = {};
const jgFiles = new Set<string>();
const txByReq = new Map<
	string,
	{ cmd: number | null; to: number[] | null; word: string; rec?: number }
>();
const POLL = new Set([0xfe0004, 0xfe000d, 0xfe0002]);
const pollTimes = new Map<string, number[]>();
const jgList: Array<{ name?: string; unique?: string; version?: string }> = [];
const lastReply = new Map<string, string>();
const records: Array<Record<string, unknown> | null> = [];
// The proxy forwards non-M2 frames (tag != 0x06) as raw: count, never decode.
const rawFrames = cap.filter((l) => conns.has(l.conn) && l["raw"] === true);
if (rawFrames.length) dropped["raw (non-M2) frames"] = rawFrames.length;
const msgs = cap.filter(
	(l) =>
		conns.has(l.conn) &&
		typeof l.hex === "string" &&
		!l.event &&
		l["raw"] !== true,
);
for (const l of msgs) {
	const session = sessionOf(l.conn);
	const c = captureMessage(
		l.seq ?? 0,
		l.dir === "c2s" ? "tx" : "rx",
		hexToBytes(l.hex as string),
	);
	if (!c.decode.ok || !c.decode.entries)
		throw new Error(`seq ${l.seq}: undecodable`);
	const entries = (c.decode.entries as Entry[]).map(fixEntry);
	const tx = l.dir === "c2s";
	const route = tx ? c.to : c.from;
	const wordE = entries.find((e) => e.key === "0xfe000c")?.value;
	const word = typeof wordE === "number" ? `0x${wordE.toString(16)}` : "absent";
	const reqKey = `${l.conn}:${c.reqId}`;
	if (tx && c.reqId !== null) {
		txByReq.set(reqKey, { cmd: c.cmd, to: c.to, word });
		if (c.cmd !== null && POLL.has(c.cmd)) {
			const k = `${session} ${pathKey(c.to)} ${CMD_NAME[c.cmd] ?? c.cmd}`;
			pollTimes.set(k, [...(pollTimes.get(k) ?? []), rel(l.wallMs)]);
		}
	}
	// A (re)subscription starts a new view: keep its first poll reply.
	if (tx && (c.cmd === 0xfe0012 || c.cmd === 0xfe0013)) {
		const view = `${session} ${pathKey(c.to)} `;
		for (const k of [...lastReply.keys()])
			if (k.startsWith(view)) lastReply.delete(k);
	}
	const req = !tx && c.reqId !== null ? txByReq.get(reqKey) : undefined;
	// The [2,2] file transfer: keep only the file names.
	const fileRoute =
		pathKey(route) === "[2,2]" || pathKey(req?.to ?? null) === "[2,2]";
	if (fileRoute) {
		const name = entries.find((e) => e.key === "0x000001")?.value;
		if (tx && c.cmd === 7 && typeof name === "string") jgFiles.add(name);
		// The "list" file is router metadata: name, unique name, crc, size.
		const data = entries.find((e) => e.key === "0x000003")?.value;
		if (!tx && typeof data === "string" && data.startsWith("hex:")) {
			const text = Buffer.from(data.slice(4), "hex").toString("utf8");
			for (const m of text.matchAll(
				/name: "([^"]+)", unique: "([^"]+)", version: "([^"]+)"/g,
			))
				jgList.push({ name: m[1], unique: m[2], version: m[3] });
		}
		dropped["[2,2] file transfer"] = (dropped["[2,2] file transfer"] ?? 0) + 1;
		continue;
	}
	const cmdOf = tx ? c.cmd : (c.cmd ?? req?.cmd ?? null);
	// Timed polls: drop a reply whose config content equals the previous
	// reply on the same route; the request stays, so the period is kept.
	// A router error is never "unchanged": keep it and its request.
	const failed = entries.some((e) => e.key === "0xff0008");
	if (!tx && req && req.cmd !== null && POLL.has(req.cmd) && !failed) {
		// Rows compare on their config group only (field id < 0xc8 or a
		// 0xfe key): the status group (f200+) carries live counters.
		const config = (e: Entry) => {
			const k = Number.parseInt(e.key, 16);
			return k < 0xc8 || k >= 0xfe0000;
		};
		const body = JSON.stringify(
			entries
				.filter((e) => !e.key.startsWith("0xff"))
				.map((e) =>
					e.key === "0xfe0002" && Array.isArray(e.value)
						? {
								...e,
								value: (e.value as Entry[][]).map((row) => row.filter(config)),
							}
						: e,
				),
		);
		const k = `${session} ${pathKey(req.to)} ${req.cmd}`;
		if (lastReply.get(k) === body) {
			const r = `${pathKey(req.to)} unchanged poll replies`;
			dropped[r] = (dropped[r] ?? 0) + 1;
			if (collapsePolls && req.rec !== undefined) {
				records[req.rec] = null;
				const q = `${pathKey(req.to)} poll requests (reply unchanged)`;
				dropped[q] = (dropped[q] ?? 0) + 1;
			}
			continue;
		}
		lastReply.set(k, body);
	}
	if (!isBridge(route) && !isBridge(req?.to ?? null)) {
		const k = `${session} ${pathKey(route)} ${l.dir} ${cmdOf}`;
		const n = (seen.get(k) ?? 0) + 1;
		seen.set(k, n);
		if (n > 2) {
			const r = `${pathKey(route)} repeats`;
			dropped[r] = (dropped[r] ?? 0) + 1;
			continue;
		}
	}
	const name = (x: number | null) =>
		x === null ? "-" : (CMD_NAME[x] ?? `0x${x.toString(16)}`);
	const withWord = (x: number | null, w: string) =>
		x === 0xfe0004 ||
		x === 0xfe0012 ||
		x === 0xfe0013 ||
		x === 0xfe000d ||
		x === 0xfe0007
			? ` 0xfe000c=${w}`
			: "";
	let role: string;
	if (tx) role = `${name(c.cmd)} ${pathKey(c.to)}${withWord(c.cmd, word)}, tx`;
	else if (c.cmd === 0xfe000b)
		role = `unsolicited NOTIFY from ${pathKey(c.from)}`;
	else if (req)
		role = `${name(req.cmd)} ${pathKey(req.to)}${withWord(req.cmd, req.word)}, reply`;
	else role = `rx from ${pathKey(c.from)}`;
	const mark = markAt(l.wallMs);
	const reqEntry = tx && c.reqId !== null ? txByReq.get(reqKey) : undefined;
	if (reqEntry) reqEntry.rec = records.length;
	records.push({
		id: `${mark}/${session}${conns.size === 1 ? "" : "."}${l.seq}`,
		role,
		source: `WinBox 4.4 via proxy.ts, conn ${l.conn} seq ${l.seq}`,
		mark,
		session,
		tMs: rel(l.wallMs),
		hex: l.hex,
		cmd: c.cmd,
		to: c.to,
		from: c.from,
		reqId: c.reqId,
		entries: (l.hex as string).length / 2 > entriesMax ? null : entries,
	});
}

// [17] rows that WinBox wrote (history read by drive.ts after the run).
const history: LetterMsg[] = [];
// No history read is fine; a broken one is an error, not partial history.
const historyPath = `${dir}/history-capture.jsonl`;
if (existsSync(historyPath)) {
	readJsonl<{ direction?: string; plaintextHex?: string }>(historyPath).forEach(
		(r, i) => {
			if (r.direction !== "rx" || !r.plaintextHex) return;
			let m: LetterMsg;
			try {
				m = decodeLetters(hexToBytes(r.plaintextHex)).msg;
			} catch (e) {
				throw new Error(
					`${historyPath} line ${i + 1}: ${(e as Error).message}`,
				);
			}
			for (const row of (m["Mfe0002"] ?? []) as LetterMsg[])
				if (String(row["s8"] ?? "").includes("winbox")) history.push(row);
		},
	);
}
const LAB_SOURCE = /@[0-9a-f.:]+$/i;
const redact = (o: LetterMsg): LetterMsg => {
	const outRow: LetterMsg = {};
	for (const [k, v] of Object.entries(o)) {
		if (k === "aff0013" || k === "u7")
			outRow[k] = k === "u7" ? 0 : "<redacted>";
		else if (typeof v === "string") outRow[k] = v.replace(LAB_SOURCE, "@<lab>");
		else if (Array.isArray(v) && v.every((x) => typeof x === "string"))
			outRow[k] = (v as string[]).map((s) => s.replace(LAB_SOURCE, "@<lab>"));
		else if (v && typeof v === "object" && !Array.isArray(v))
			outRow[k] = redact(v as LetterMsg);
		else outRow[k] = v;
	}
	return outRow;
};

const median = (xs: number[]) => {
	const d = xs
		.slice(1)
		.map((x, i) => x - (xs[i] as number))
		.sort((a, b) => a - b);
	if (!d.length) return null;
	const mid = Math.floor(d.length / 2);
	const m =
		d.length % 2
			? (d[mid] as number)
			: ((d[mid - 1] as number) + (d[mid] as number)) / 2;
	return Math.round(m);
};
const pollPeriods = Object.fromEntries(
	[...pollTimes]
		.filter(([, t]) => t.length > 2)
		.map(([k, t]) => [k, { requests: t.length, median_ms: median(t) }]),
);
const connectionEvents = cap
	.filter((l) => l.event && l.event !== "proxy-start" && l.event !== "phase1")
	.map((l) => {
		const { wallMs, tMs: _t, peer: _p, ...rest } = l;
		return { tMs: rel(wallMs), ...rest };
	});
const meta: Record<string, unknown> = metaPath
	? (JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>)
	: {};
const provenance = {
	report:
		"plan step 5: WinBox 4 running the Bridge workflow through the decrypting proxy (work/2026-11-jg-descriptors/winbox4/), 2026-11-22",
	routeros_version: start["routeros_version"],
	packages: ["routeros 7.25 (2026-10-22 14:12:00), no extra packages"],
	route: [
		[16, 2],
		[20, 0],
	],
	client: {
		name: "WinBox",
		version: "4.4 (Arch package winbox 4.4-1)",
		os: "Linux x86_64 (omarchy, Hyprland/XWayland)",
		elf_build_id: "9d89314280d8c62256ab79961936bb90fe54d2ce",
	},
	capture_method:
		"proxy.ts: WinBox logs in to the proxy (server-side EC-SRP5, srp-server.ts), the proxy logs in to the router and relays each M2 message decrypted; UI marks are the operator's confirmations after each step (not the exact click time)",
	jg_unique_names: [...new Set(jgList.map((j) => j.unique))].sort(),
	files_fetched: [...jgFiles],
	session:
		conns.size === 1
			? "W = the one WinBox connection; replies address TO=[0,n] where n is the WinBox handler that asked"
			: `W<n> = WinBox proxy connection n (${[...conns].join(", ")}); replies address TO=[0,n] where n is the WinBox handler that asked`,
	lab_rows:
		"ports *0 (m2ir-vl1, comment m2ir-p1) and *1 (m2ir-vl2, comment m2ir-p2) on bridge m2ir-br; comments changed over REST to m2ir-p1-c1 (window open) and m2ir-p1-c2 (window closed)",
	control:
		"centrs over rest-api (drive.ts): setup, the two comment changes, print, cleanup",
	timeline,
	dropped,
	...(collapsePolls ? { poll_periods: pollPeriods } : {}),
	...(conns.size > 1 || connectionEvents.some((e) => e["event"] === "drop")
		? { connection_events: connectionEvents }
		: {}),
	entries_max_bytes: entriesMax,
	history_winbox: history.map(redact),
	...meta,
	note: "Sanitized M2 hex plus decoded entries: no hosts, ports, credentials or capture wall-clock time (tMs is ms since the WinBox login; the timeline uses the same origin). Router clock values inside [24,*] replies are the lab CHR's own. The plaintext starts after the SRP login. history_winbox: aff0013 (client address) redacted, u7 (time) zeroed, source address -> @<lab>.",
};
const body = records
	.filter((r) => r !== null)
	.map((r) => `\t\t${JSON.stringify(r)}`)
	.join(",\n");
writeFileSync(
	out,
	`{\n\t"provenance": ${JSON.stringify(provenance)},\n\t"records": [\n${body}\n\t]\n}\n`,
);
console.log(
	`fixture: ${records.filter((r) => r !== null).length} records, dropped ${JSON.stringify(dropped)}, ${jgFiles.size} .jg names, ${history.length} history rows -> ${out}`,
);
