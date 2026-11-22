// cspell:ignore webfig
/**
 * Offline analysis of a native-replay.ts capture (plan step 4).
 *
 *   bun native-report.ts <capture-dir> [<webfig-fixture.jsonl>] [--json <out>]
 *
 * Decodes every message into WebFig's letter-keyed form (webfig/m2-letters.ts)
 * so native rows compare key-for-key with the step 3 transcripts. Prints one
 * section per question and, with --json, writes the same data as JSON.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
	decodeLetters,
	hexToBytes,
	type LetterMsg,
} from "./webfig/m2-letters.ts";

const NOTIFY = 0xfe000b;
const GETALL = 0xfe0004;
const WRITES = new Set([0xfe0003, 0xfe0005, 0xfe0006, 0xfe0007]);
const CMD_NAME: Record<number, string> = {
	16646147: "SETOBJ",
	16646148: "GETALL",
	16646149: "ADDOBJ",
	16646150: "REMOVEOBJ",
	16646151: "MOVEOBJ",
	16646155: "NOTIFY",
	16646162: "SUBSCRIBE",
	16646163: "UNSUBSCRIBE",
};

export interface NativeEvent {
	session: string;
	seq: number;
	direction: "tx" | "rx";
	tMs: number;
	mark: string;
	msg: LetterMsg;
	hex: string;
}

interface CaptureLine {
	mark?: string;
	tMs?: number;
	session?: string;
	seq?: number;
	direction?: "tx" | "rx";
	plaintextHex?: string;
}

export function loadNative(dir: string): {
	events: NativeEvent[];
	meta: Record<string, unknown>;
} {
	const lines = readFileSync(`${dir}/capture.jsonl`, "utf8")
		.trim()
		.split("\n")
		.map((l) => JSON.parse(l) as CaptureLine);
	const events: NativeEvent[] = [];
	let mark = "";
	for (const l of lines) {
		if (l.mark) {
			mark = l.mark;
			continue;
		}
		if (!l.plaintextHex || !l.session || l.direction === undefined) continue;
		events.push({
			session: l.session,
			seq: l.seq ?? -1,
			direction: l.direction,
			tMs: l.tMs ?? 0,
			mark,
			msg: decodeLetters(hexToBytes(l.plaintextHex)).msg,
			hex: l.plaintextHex,
		});
	}
	const meta = JSON.parse(readFileSync(`${dir}/meta.json`, "utf8")) as Record<
		string,
		unknown
	>;
	return { events, meta };
}

const path = (m: LetterMsg, k: string) => JSON.stringify(m[k] ?? null);
const rowsOf = (m: LetterMsg) => (m["Mfe0002"] ?? []) as LetterMsg[];
const keys = (r: LetterMsg) => Object.keys(r).sort();
const sig = (ks: string[]) => ks.join(",");

/** tx request for each rx reply, by session + SYS_REQID. */
export function pairReplies(
	events: NativeEvent[],
): Map<NativeEvent, NativeEvent> {
	const tx = new Map<string, NativeEvent>();
	const out = new Map<NativeEvent, NativeEvent>();
	for (const e of events) {
		const id = e.msg["uff0006"];
		if (id === undefined) continue;
		const k = `${e.session}/${id}`;
		if (e.direction === "tx") tx.set(k, e);
		else {
			const t = tx.get(k);
			if (t) out.set(e, t);
		}
	}
	return out;
}

export function notifications(events: NativeEvent[]): NativeEvent[] {
	return events.filter(
		(e) => e.direction === "rx" && e.msg["uff0007"] === NOTIFY,
	);
}

function webfigRows(file: string): {
	notify: Array<{ seq: number; from: string; row: LetterMsg }>;
	getall: Array<{ seq: number; from: string; word: unknown; row: LetterMsg }>;
} {
	const lines = readFileSync(file, "utf8").trim().split("\n").slice(1);
	const notify: Array<{ seq: number; from: string; row: LetterMsg }> = [];
	const getall: Array<{
		seq: number;
		from: string;
		word: unknown;
		row: LetterMsg;
	}> = [];
	const pending = new Map<string, unknown>();
	for (const line of lines) {
		const e = JSON.parse(line) as { seq: number; dir: string; msg?: LetterMsg };
		const m = e.msg;
		if (!m) continue;
		if (e.dir === "tx" && m["uff0007"] === GETALL)
			pending.set(path(m, "Uff0001"), m["ufe000c"]);
		if (e.dir !== "rx") continue;
		const from = path(m, "Uff0002");
		if (m["uff0007"] === NOTIFY)
			for (const row of rowsOf(m)) notify.push({ seq: e.seq, from, row });
		else if (pending.has(from) && rowsOf(m).length > 0) {
			for (const row of rowsOf(m))
				getall.push({ seq: e.seq, from, word: pending.get(from), row });
			pending.delete(from);
		}
	}
	return { notify, getall };
}

function cmp(a: string[], b: string[]) {
	const sa = new Set(a);
	const sb = new Set(b);
	return {
		equal: a.length === b.length && a.every((k) => sb.has(k)),
		onlyNative: a.filter((k) => !sb.has(k)),
		onlyWebfig: b.filter((k) => !sa.has(k)),
	};
}

export function analyze(dir: string, webfig?: string) {
	const { events, meta } = loadNative(dir);
	const replies = pairReplies(events);
	const notes = notifications(events);

	// q1: every notification with its trigger and latency. Index the write
	// acks per mark first: a notification can arrive before the writer's
	// ack (negative afterAckMs).
	const acks = new Map<string, NativeEvent[]>();
	for (const e of events) {
		const t = replies.get(e);
		// File the ack under its request's mark: a late ack belongs to the
		// write that asked, not to the step it happened to arrive in.
		if (t && WRITES.has(t.msg["uff0007"] as number))
			acks.set(t.mark, [...(acks.get(t.mark) ?? []), e]);
	}
	const ackFor = (e: NativeEvent): NativeEvent | undefined => {
		const list = acks.get(e.mark) ?? [];
		return list.filter((a) => a.tMs <= e.tMs).at(-1) ?? list[0];
	};
	const q1: Array<Record<string, unknown>> = [];
	for (const e of events) {
		if (e.direction !== "rx" || e.msg["uff0007"] !== NOTIFY) continue;
		const w = ackFor(e);
		const top = Object.keys(e.msg)
			.filter((k) => k !== "Mfe0002")
			.sort();
		q1.push({
			mark: e.mark,
			at: `${e.session}${e.seq}`,
			to: e.msg["Uff0001"],
			from: e.msg["Uff0002"],
			top,
			rows: rowsOf(e.msg).map((r) => ({
				id: r["ufe0001"],
				keys: keys(r).length,
				next: r["ufe0005"],
				dead: r["ufe0013"],
				name: r["s10006"],
				comment: r["sfe0009"],
			})),
			afterAckMs: w ? Math.round(e.tMs - w.tMs) : null,
		});
	}

	// q2: GETALL key sets per 0xfe000c word, per row.
	const q2: Record<string, Record<string, Record<string, number>>> = {};
	const sigs: Record<string, Record<string, string>> = {};
	for (const [rx, tx] of replies) {
		if (tx.msg["uff0007"] !== GETALL || rx.mark !== "q2-words") continue;
		const p = path(tx.msg, "Uff0001");
		const w =
			tx.msg["ufe000c"] === undefined
				? "absent"
				: `0x${(tx.msg["ufe000c"] as number).toString(16)}`;
		q2[p] ??= {};
		sigs[p] ??= {};
		const perRow: Record<string, number> = {};
		const rowSigs: string[] = [];
		for (const r of rowsOf(rx.msg)) {
			const name = String(r["s10006"] ?? r["ufe0001"]);
			perRow[name] = keys(r).length;
			rowSigs.push(`${name}:${sig(keys(r))}`);
		}
		(q2[p] as Record<string, Record<string, number>>)[w] = perRow;
		(sigs[p] as Record<string, string>)[w] = rowSigs.join("|");
	}
	const classes: Record<string, string[][]> = {};
	for (const [p, byWord] of Object.entries(sigs)) {
		const groups = new Map<string, string[]>();
		for (const [w, s] of Object.entries(byWord)) {
			groups.set(s, [...(groups.get(s) ?? []), w]);
		}
		classes[p] = [...groups.values()];
	}

	// Keys the status bit adds, per path (bridge row and first port row).
	const rowAt = (
		p: string,
		w: string | undefined,
		pick: (r: LetterMsg) => boolean,
	) => {
		for (const [rx, tx] of replies) {
			if (tx.msg["uff0007"] !== GETALL || rx.mark !== "q2-words") continue;
			if (path(tx.msg, "Uff0001") !== p) continue;
			const tw = tx.msg["ufe000c"];
			if (
				(w === undefined && tw !== undefined) ||
				(w !== undefined && tw !== Number(w))
			)
				continue;
			return rowsOf(rx.msg).find(pick);
		}
		return undefined;
	};
	const isBridge = (r: LetterMsg) => r["s10006"] === "m2ir-br";
	const anyRow = () => true;
	const bridgeCfg = rowAt("[20,0]", undefined, isBridge);
	const bridgeFull = rowAt("[20,0]", "0x1004000f", isBridge);
	const portCfg = rowAt("[16,2]", undefined, anyRow);
	const portFull = rowAt("[16,2]", "0x10000007", anyRow);
	const statusKeys = {
		"[20,0] bridge":
			bridgeCfg && bridgeFull
				? cmp(keys(bridgeFull), keys(bridgeCfg)).onlyNative
				: null,
		"[16,2] port":
			portCfg && portFull
				? cmp(keys(portFull), keys(portCfg)).onlyNative
				: null,
	};

	// q3: notifications per listen window, per session, with row sizes.
	const q3: Record<string, string[]> = {};
	for (const m of new Set(events.map((e) => e.mark))) {
		if (!m.startsWith("q3")) continue;
		for (const s of ["A", "C"]) {
			const got = notes.filter((n) => n.mark === m && n.session === s);
			if (s === "C" && !m.startsWith("q3c")) continue;
			q3[`${m} ${s}`] = got.map(
				(n) =>
					`${path(n.msg, "Uff0002")}:${rowsOf(n.msg)
						.map((r) => keys(r).length)
						.join("+")}`,
			);
		}
	}

	// q4: port order (id>next) after each GETALL of [16,2] from q4 on.
	const q4: Array<Record<string, unknown>> = [];
	for (const e of events) {
		if (!e.mark.startsWith("q4")) continue;
		const t = replies.get(e);
		if (e.direction === "tx" && WRITES.has(e.msg["uff0007"] as number)) {
			const m = { ...e.msg };
			for (const k of ["bff0005", "uff0006", "Uff0002"]) delete m[k];
			q4.push({
				mark: e.mark,
				tx: CMD_NAME[e.msg["uff0007"] as number],
				req: m,
			});
		}
		if (
			t &&
			t.msg["uff0007"] === GETALL &&
			path(t.msg, "Uff0001") === "[16,2]"
		) {
			q4.push({
				mark: e.mark,
				order: rowsOf(e.msg).map(
					(r) =>
						`${r["ufe0001"]}>${r["ufe0005"] === 0xffffffff ? "end" : r["ufe0005"]}`,
				),
				count: e.msg["ufe0019"],
			});
		}
	}

	// Comparison with the WebFig transcript.
	let vsWebfig: Record<string, unknown> | null = null;
	if (webfig) {
		const wf = webfigRows(webfig);
		const nb = notes.find(
			(n) =>
				n.mark === "q1-bridge-comment" && path(n.msg, "Uff0002") === "[20,0]",
		);
		const np = notes.find(
			(n) =>
				n.mark === "q1-port-comment" && path(n.msg, "Uff0002") === "[16,2]",
		);
		const wfBridgeNote = wf.notify.find(
			(x) =>
				x.from === "[20,0]" &&
				x.row["s10006"] === "m2ir-br" &&
				Object.keys(x.row).length > 2,
		);
		const wfp = wf.notify.find(
			(x) => x.from === "[16,2]" && x.row["ufe0005"] !== undefined,
		);
		const gb = rowAt("[20,0]", "0x1004000f", isBridge);
		const gp = rowAt("[16,2]", "0x10000007", anyRow);
		const wfBridgeRow = wf.getall.find(
			(x) => x.from === "[20,0]" && x.row["s10006"] === "m2ir-br",
		);
		const wfPortRow = wf.getall.find((x) => x.from === "[16,2]");
		const row = (n?: NativeEvent) => (n ? rowsOf(n.msg)[0] : undefined);
		const both = (a?: LetterMsg, b?: LetterMsg, seq?: number) =>
			a && b
				? {
						webfigSeq: seq,
						native: keys(a).length,
						webfig: keys(b).length,
						...cmp(keys(a), keys(b)),
					}
				: null;
		vsWebfig = {
			"notify [20,0] bridge": both(
				row(nb),
				wfBridgeNote?.row,
				wfBridgeNote?.seq,
			),
			"notify [16,2] port": both(row(np), wfp?.row, wfp?.seq),
			"getall [20,0] bridge 0x1004000f": both(
				gb,
				wfBridgeRow?.row,
				wfBridgeRow?.seq,
			),
			"getall [16,2] port 0x10000007": both(gp, wfPortRow?.row, wfPortRow?.seq),
		};
	}

	return { meta, q1, q2, classes, statusKeys, q3, q4, vsWebfig };
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const jsonAt = args.indexOf("--json");
	const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : undefined;
	const pos = args.filter(
		(a, i) => !a.startsWith("--") && (jsonAt < 0 || i !== jsonAt + 1),
	);
	const [dir, webfig] = pos;
	if (!dir) {
		console.error(
			"usage: native-report.ts <capture-dir> [<webfig.jsonl>] [--json <out>]",
		);
		process.exit(2);
	}
	const r = analyze(dir, webfig);
	console.log(`# ${r.meta["machine"]} RouterOS ${r.meta["routeros_version"]}`);
	console.log("\n## q1 notifications");
	for (const n of r.q1) console.log(JSON.stringify(n));
	console.log("\n## q2 key counts per word");
	console.log(JSON.stringify(r.q2, null, 1));
	console.log("\n## q2 word classes (identical key sets)");
	console.log(JSON.stringify(r.classes));
	console.log("\n## q2 keys added by the status bit");
	console.log(JSON.stringify(r.statusKeys));
	console.log("\n## q3 notifications per window");
	console.log(JSON.stringify(r.q3, null, 1));
	console.log("\n## q4");
	for (const x of r.q4) console.log(JSON.stringify(x));
	if (r.vsWebfig) {
		console.log("\n## vs WebFig");
		console.log(JSON.stringify(r.vsWebfig, null, 1));
	}
	if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(r, null, "\t")}\n`);
}
