// cspell:ignore webfig jsproxy
/**
 * Turn a capture.ts run into a sanitized plaintext transcript.
 *
 *   bun transcript.ts <capture-dir> [<fixture.jsonl>] [--digest] [--compact]
 *
 * Reads <capture-dir>/raw.jsonl and meta.json. Writes JSONL: line 1 is
 * {"provenance": ...}; every later line is one event in capture order:
 *   {"seq","t","mark", ...}             driver step (capture.ts)
 *   {"seq","t","x","dir":"tx","poll"?,"msg","hex"}  one request message
 *   {"seq","t","x","dir":"rx","msg","hex"}          one reply/notification frame
 *   {"seq","t","x","dir":"http","status","ms"}      exchange finished
 *   {"seq","t","x","dir":"uri","path"}              file fetched over /jsproxy
 * t is ms since page load (browser clock); x numbers the HTTP exchange that
 * carried the bytes. "poll" marks WebFig's notification long poll: a POST
 * whose message is only Sff001c, answered when the router has
 * notifications (or after a timeout).
 *
 * Sanitizing: the login request's s3 (password) and the login reply's s2d
 * (session token) are replaced by "<redacted>" and their hex is dropped.
 * --digest prints one line per event instead of writing a file.
 *
 * --compact (for fixtures): for [20,0] [16,2] [20,90] [1], the first
 * reply per path after each driver mark is kept in full; for other paths
 * only the first reply of the run, and only if it has at most 20 rows
 * (the [24,7] time-zone pages keep their paging keys); later replies (the autorefresh repeats) keep only
 * their SYS_* and paging/count keys plus "row_ids", with "elided": true
 * and hex null. Notifications (uff0007 0xfe000b) from [20,0] [16,2]
 * [20,90] [1] are kept in full; from other paths (the [17] undo history)
 * only the first. Requests are always kept in full.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	decodeLetters,
	hexToBytes,
	type LetterMsg,
	type LetterValue,
	splitFrames,
} from "./m2-letters.ts";

const args = process.argv.slice(2);
const digest = args.includes("--digest");
const compact = args.includes("--compact");
const focus = new Set(["[20,0]", "[16,2]", "[20,90]", "[1]"]);
const [dir, outFile] = args.filter((a) => !a.startsWith("--"));
if (!dir) {
	console.error(
		"usage: bun transcript.ts <capture-dir> [<fixture.jsonl>] [--digest] [--compact]",
	);
	process.exit(2);
}

interface RawEvent {
	k: string;
	t?: number;
	x?: number | null;
	hex?: string;
	path?: string;
	status?: number;
	ms?: number;
	label?: string;
	[extra: string]: unknown;
}

/** One transcript line (see the header for the shapes). */
export interface TEvent {
	seq?: number;
	t?: number;
	x?: number | null;
	dir?: string;
	mark?: string;
	poll?: boolean;
	msg?: LetterMsg;
	hex?: string | null;
	status?: number;
	ms?: number;
	path?: string;
	[extra: string]: unknown;
}

interface Meta {
	routeros_version?: string;
	captured?: string;
	browser?: string;
	assets_sha256?: Record<string, string>;
	fetched?: string[];
	lab_rows?: Record<string, number>;
}

/** Read a letter key (keys are data, so no dotted access). */
const at = (m: LetterMsg, k: string): LetterValue | undefined => m[k];

/**
 * Login exchange only: the request {s1 user, s3 password} has no SYS_TO,
 * the reply carrying s2d (token) has no SYS_FROM. s3 elsewhere is data
 * (for example the [17] undo history).
 */
function secretKeys(dir: string, msg: LetterMsg): string[] {
	if (dir === "tx" && "s3" in msg && !("Uff0001" in msg)) return ["s3"];
	if (dir === "rx" && "s2d" in msg && !("Uff0002" in msg)) return ["s2d"];
	return [];
}

export function buildTranscript(raw: RawEvent[]): TEvent[] {
	const out: TEvent[] = [];
	let seq = 0;
	const push = (e: TEvent) => out.push({ seq: ++seq, ...e });
	for (const e of raw) {
		switch (e.k) {
			case "mark": {
				const { k: _k, t, label, ...extra } = e;
				push({ t, mark: label, ...extra });
				break;
			}
			case "tx":
			case "rx": {
				const bytes = hexToBytes(e.hex ?? "");
				const frames = e.k === "tx" ? [bytes] : splitFrames(bytes);
				for (const f of frames) {
					const { msg } = decodeLetters(f);
					const secret = secretKeys(e.k, msg);
					for (const k of secret) msg[k] = "<redacted>";
					const hex = secret.length ? null : Buffer.from(f).toString("hex");
					const poll =
						e.k === "tx" && Object.keys(msg).length === 1 && "Sff001c" in msg;
					push({
						t: e.t,
						x: e.x,
						dir: e.k,
						...(poll ? { poll: true } : {}),
						msg,
						hex,
						...(secret.length ? { redacted: secret } : {}),
					});
				}
				break;
			}
			case "done":
				push({ t: e.t, x: e.x, dir: "http", status: e.status, ms: e.ms });
				break;
			case "uri":
				push({ t: e.t, x: e.x, dir: "uri", path: e.path });
				break;
			case "send":
			case "hooked":
				break;
			default:
				push({ t: e.t, note: e.k, ...e });
		}
	}
	return out;
}

/** Shrink repeated replies; see --compact in the header. */
export function compactTranscript(events: TEvent[], focusPaths: Set<string>) {
	let sinceMark = new Set<string>();
	const seenNotify = new Set<string>();
	const seenOther = new Set<string>();
	return events.map((e) => {
		if (e.mark) sinceMark = new Set();
		const msg = e.msg;
		if (e.dir !== "rx" || !(msg && at(msg, "Uff0002"))) return e;
		// A router error is evidence: never shorten it, never let it
		// mark a path as seen.
		if (at(msg, "uff0008") !== undefined) return e;
		const path = JSON.stringify(at(msg, "Uff0002"));
		const notify = at(msg, "uff0007") === 0xfe000b;
		// A SUBSCRIBE ack and a GETALL reply share a path; key on rows too.
		const key = notify
			? `n${path}`
			: `${path}${at(msg, "Mfe0002") ? "+rows" : ""}`;
		const focused = focusPaths.has(path);
		const keep = notify
			? focused || !seenNotify.has(path)
			: !sinceMark.has(key) &&
				(focused ||
					(!seenOther.has(key) &&
						((at(msg, "Mfe0002") as LetterMsg[] | undefined)?.length ?? 0) <=
							20));
		if (notify) seenNotify.add(path);
		else {
			sinceMark.add(key);
			seenOther.add(key);
		}
		if (keep) return e;
		const summary: LetterMsg = {};
		for (const k of [
			"Uff0001",
			"Uff0002",
			"uff0006",
			"uff0007",
			"ufe0003",
			"ufe0019",
		]) {
			if (msg[k] !== undefined) summary[k] = msg[k] as LetterMsg[string];
		}
		const rows = at(msg, "Mfe0002") as LetterMsg[] | undefined;
		const ids = rows?.map((r) => at(r, "ufe0001") as number);
		return {
			...e,
			msg: summary,
			hex: null,
			elided: true,
			...(ids ? { row_ids: ids } : {}),
		};
	});
}

const hex = (n: unknown) =>
	typeof n === "number" ? `0x${n.toString(16)}` : String(n);

/** One-line summary of an event for reading a run. */
export function digestLine(e: TEvent): string {
	const head = `${String(e.seq).padStart(4)} ${String(e.t).padStart(6)} x${String(e.x ?? "-").padEnd(4)}`;
	if (e.mark)
		return `${head} ==== ${e.mark} ${JSON.stringify({ ...e, seq: undefined, t: undefined, mark: undefined })}`;
	if (e.dir === "http") return `${head} http ${e.status} ${e.ms}ms`;
	if (e.dir === "uri") return `${head} uri ${e.path}`;
	const m = e.msg ?? {};
	if (e.poll) return `${head} tx POLL`;
	const parts: string[] = [`${e.dir}`];
	if (at(m, "Uff0001")) parts.push(`to=${JSON.stringify(at(m, "Uff0001"))}`);
	if (at(m, "Uff0002")) parts.push(`from=${JSON.stringify(at(m, "Uff0002"))}`);
	if (at(m, "uff0007") !== undefined)
		parts.push(`cmd=${hex(at(m, "uff0007"))}`);
	if (at(m, "uff0006") !== undefined) parts.push(`req=${at(m, "uff0006")}`);
	if (at(m, "uff0008") !== undefined)
		parts.push(`ERR=${hex(at(m, "uff0008"))}`);
	const rows = at(m, "Mfe0002") as LetterMsg[] | undefined;
	if (rows) {
		parts.push(
			`rows=${rows.length}[${rows
				.map((r) => {
					const id = at(r, "ufe0001");
					const flags = ["ufe0005", "ufe0013", "ufe0019"]
						.filter((k) => k in r)
						.map((k) => `${k}=${hex(r[k])}`);
					const c =
						at(r, "sfe0009") !== undefined ? ` "${at(r, "sfe0009")}"` : "";
					return `${hex(id)}${c}${flags.length ? ` ${flags.join(",")}` : ""}`;
				})
				.join(" ")}]`,
		);
	}
	const skip = new Set([
		"Uff0001",
		"Uff0002",
		"uff0007",
		"uff0006",
		"uff0008",
		"Mfe0002",
		"Sff001c",
		"uff0003",
		"uff0004",
	]);
	const rest = Object.keys(m).filter((k) => !skip.has(k));
	if (rest.length) {
		parts.push(
			rest
				.slice(0, 12)
				.map((k) => {
					const v = m[k];
					return typeof v === "object"
						? k
						: `${k}=${typeof v === "number" ? hex(v) : JSON.stringify(v)}`;
				})
				.join(" ") + (rest.length > 12 ? ` (+${rest.length - 12})` : ""),
		);
	}
	return `${head} ${parts.join(" ")}`;
}

if (import.meta.main) {
	const raw = readFileSync(join(dir, "raw.jsonl"), "utf8")
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l) as RawEvent);
	const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as Meta;
	const built = buildTranscript(raw);
	const events = compact ? compactTranscript(built, focus) : built;
	if (digest || !outFile) {
		for (const e of events) console.log(digestLine(e));
	}
	if (outFile) {
		const fetched = meta.fetched ?? [];
		const provenance = {
			source:
				"WebFig (MikroTik's browser client) in headless Chromium; plaintext hooked above the /jsproxy cipher",
			capture: "work/2026-11-jg-descriptors/webfig/capture.ts",
			routeros_version: meta.routeros_version,
			// The day only: the sanitized fixture carries no wall-clock time.
			captured_on: meta.captured?.slice(0, 10),
			browser: meta.browser,
			webfig_assets_sha256: meta.assets_sha256,
			jg_unique_names: fetched
				.filter((p) => p.endsWith(".jg"))
				.map((p) => p.replace("/webfig/", "")),
			lab_rows: meta.lab_rows,
			sanitized:
				"login s3 (password) and s2d (session token) redacted with their hex; no hosts, ports or other credentials",
			note: "msg is the letter-keyed object form WebFig's buffer2msg builds (type letter + 24-bit key hex); hex is the exact plaintext M2. t = ms since page load.",
		};
		writeFileSync(
			outFile,
			`${[JSON.stringify({ provenance }), ...events.map((e) => JSON.stringify(e))].join("\n")}\n`,
		);
		console.error(`${events.length} events -> ${outFile}`);
	}
}
