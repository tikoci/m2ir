// Native replay of the step 3 Bridge workflow (plan step 4), checked
// against the WebFig transcripts where the two overlap.
//
// Fixtures: fixtures/winbox-ipc/{6.49,7.25,7.26beta4}-native-bridge-workflow.json,
// made by work/2026-11-jg-descriptors/native-fixture.ts from native-replay.ts
// captures. Session A subscribes and reads, B changes rows, C probes
// subscription bookkeeping. The schema entries under test are in
// profiles/winbox-ipc/std-commands.yaml (0xfe000b, 0xfe0012, 0xfe0013,
// 0xfe0007) and std-keys.yaml (0xfe000c, 0xfe0005, 0xfe0013).
//
// The mini parser (./m2-replay.ts) is independent of the work/ decoders.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { FixtureEntry, FixtureRecord } from "./m2-replay";
import {
	decodeFixtureEntries,
	findEntry,
	loadFixture,
	loadYamlDoc,
	repoPath,
	required,
	requiredEntry,
	rowsOf,
} from "./m2-replay";

interface NativeRecord extends FixtureRecord {
	mark: string;
	session: string;
	tMs: number;
	entries: FixtureEntry[];
}

const NOTIFY = 0xfe000b;
const GETALL = 0xfe0004;
type Version = "7.25" | "7.26beta4" | "6.49";
const VERSIONS: Version[] = ["7.25", "7.26beta4", "6.49"];
const V7: Version[] = ["7.25", "7.26beta4"];
const WEBFIG: Partial<Record<Version, string>> = {
	"7.25": "7.25-webfig-bridge-workflow.jsonl",
	"7.26beta4": "7.26beta4-webfig-bridge-workflow.jsonl",
};

// WebFig's type letters (FT_* = tcode >> 3), to compare native rows with
// the letter-keyed WebFig transcript.
const LETTER: Record<number, string> = {
	0: "b",
	1: "u",
	2: "q",
	3: "a",
	4: "s",
	5: "m",
	6: "r",
	16: "B",
	17: "U",
	18: "Q",
	19: "A",
	20: "S",
	21: "M",
	22: "R",
};
function letterKeys(row: FixtureEntry[]): string[] {
	return row
		.map((e) => {
			const t = Number.parseInt(e.tcode, 16);
			return `${required(LETTER[t >> 3], `letter for ${e.tcode}`)}${Number.parseInt(e.key, 16).toString(16)}`;
		})
		.sort();
}

const cache = new Map<Version, NativeRecord[]>();
function records(v: Version): NativeRecord[] {
	const hit = cache.get(v);
	if (hit) return hit;
	const fx = loadFixture(`${v}-native-bridge-workflow.json`);
	const out = fx.records.map((r) => ({
		...(r as NativeRecord),
		entries: decodeFixtureEntries(r.hex),
	}));
	cache.set(v, out);
	return out;
}

const val = (es: FixtureEntry[], key: string) => findEntry(es, key)?.value;
const rows = (r: NativeRecord) => {
	const e = findEntry(r.entries, "0xfe0002");
	return e ? rowsOf(e) : [];
};
const isNotify = (r: NativeRecord, from?: string) =>
	r.cmd === NOTIFY && (from === undefined || JSON.stringify(r.from) === from);
const notifies = (v: Version, mark: string, session: string, from?: string) =>
	records(v).filter(
		(r) => r.mark === mark && r.session === session && isNotify(r, from),
	);
const named = (rs: FixtureEntry[][], name: string) =>
	required(
		rs.find((row) => val(row, "0x010006") === name),
		`row named ${name}`,
	);

/** GETALL reply rows for a path and 0xfe000c word ("absent" = no word). */
function getall(v: Version, mark: string, to: string, word: string) {
	const recs = records(v);
	for (const tx of recs) {
		if (tx.mark !== mark || tx.cmd !== GETALL || JSON.stringify(tx.to) !== to)
			continue;
		const w = val(tx.entries, "0xfe000c");
		const got = typeof w === "number" ? `0x${w.toString(16)}` : "absent";
		if (got !== word) continue;
		const rx = recs.find(
			(r) =>
				r.session === tx.session &&
				r.reqId === tx.reqId &&
				r.cmd === null &&
				r.from !== null &&
				JSON.stringify(r.from) === to,
		);
		if (rx) return rows(rx);
	}
	throw new Error(`${v}: no GETALL ${to} ${word} reply in ${mark}`);
}

interface WebfigMsg {
	[k: string]: unknown;
}
function webfig(file: string) {
	const lines = readFileSync(repoPath(`fixtures/winbox-ipc/${file}`), "utf8")
		.trim()
		.split("\n")
		.slice(1)
		.map((l) => JSON.parse(l) as { seq: number; dir: string; msg?: WebfigMsg });
	const notify: Array<{ seq: number; from: string; row: WebfigMsg }> = [];
	const replies: Array<{
		seq: number;
		from: string;
		word: unknown;
		row: WebfigMsg;
	}> = [];
	const pending = new Map<string, unknown>();
	for (const e of lines) {
		const m = e.msg;
		if (!m) continue;
		if (e.dir === "tx" && m["uff0007"] === GETALL)
			pending.set(JSON.stringify(m["Uff0001"]), m["ufe000c"]);
		if (e.dir !== "rx") continue;
		const from = JSON.stringify(m["Uff0002"]);
		const rs = (m["Mfe0002"] ?? []) as WebfigMsg[];
		if (m["uff0007"] === NOTIFY)
			for (const row of rs) notify.push({ seq: e.seq, from, row });
		else if (pending.has(from) && rs.length > 0) {
			for (const row of rs)
				replies.push({ seq: e.seq, from, word: pending.get(from), row });
			pending.delete(from);
		}
	}
	return { notify, replies };
}

describe("native Bridge workflow fixtures", () => {
	test.each(VERSIONS)("%s: hex re-decodes to the recorded entries", (v) => {
		const fx = loadFixture(`${v}-native-bridge-workflow.json`);
		expect(String(fx.provenance.routeros_version)).toStartWith(v);
		expect(fx.records.length).toBeGreaterThan(150);
		for (const r of fx.records) {
			const decoded = decodeFixtureEntries(r.hex);
			if (r.entries !== null) expect(decoded).toEqual(r.entries);
		}
	});
});

describe("q1: CMD_NOTIFY on the native transport", () => {
	test.each(
		VERSIONS,
	)("%s: a change from session B reaches subscriber A as CMD_NOTIFY", (v) => {
		const [n] = notifies(v, "q1-bridge-comment", "A", "[20,0]");
		const note = required(n, "bridge notification");
		// Native: TO is the session's own address, not WebFig's TO=[].
		expect(note.to).toEqual([0, 11]);
		expect(note.reqId).toBeNull();
		expect(val(named(rows(note), "m2ir-br"), "0xfe0009")).toBe("m2ir-n1");
		const [p] = notifies(v, "q1-port-comment", "A", "[16,2]");
		const port = required(p, "port notification");
		expect(val(required(rows(port)[0], "port row"), "0xfe0009")).toBe(
			"m2ir-n2",
		);
		expect(typeof val(port.entries, "0xfe0019")).toBe("number");
		// The other client B is not subscribed and gets nothing.
		expect(records(v).filter((r) => r.session === "B" && isNotify(r))).toEqual(
			[],
		);
	});

	test.each(
		V7,
	)("%s: notification and GETALL rows match WebFig key for key", (v) => {
		const wf = webfig(required(WEBFIG[v], "webfig fixture"));
		const nb = named(
			rows(required(notifies(v, "q1-bridge-comment", "A", "[20,0]")[0], "nb")),
			"m2ir-br",
		);
		const wfBridgeNote = required(
			wf.notify.find(
				(x) =>
					x.from === "[20,0]" &&
					x.row["s10006"] === "m2ir-br" &&
					Object.keys(x.row).length > 2,
			),
			"webfig bridge notify",
		);
		expect(letterKeys(nb)).toEqual(Object.keys(wfBridgeNote.row).sort());
		const np = required(
			rows(required(notifies(v, "q1-port-comment", "A", "[16,2]")[0], "np"))[0],
			"np row",
		);
		const wfPortNote = required(
			wf.notify.find(
				(x) => x.from === "[16,2]" && x.row["ufe0005"] !== undefined,
			),
			"webfig port notify",
		);
		expect(letterKeys(np)).toEqual(Object.keys(wfPortNote.row).sort());
		// GETALL with WebFig's own words: same rows as WebFig received.
		const gb = named(
			getall(v, "q1-subscribe", "[20,0]", "0x1004000f"),
			"m2ir-br",
		);
		const wfBridgeRow = required(
			wf.replies.find(
				(x) => x.from === "[20,0]" && x.row["s10006"] === "m2ir-br",
			),
			"webfig bridge getall",
		);
		expect(wfBridgeRow.word).toBe(0x1004000f);
		expect(letterKeys(gb)).toEqual(Object.keys(wfBridgeRow.row).sort());
		const gp = required(
			getall(v, "q1-subscribe", "[16,2]", "0x10000007")[0],
			"gp",
		);
		const wfPortRow = required(
			wf.replies.find((x) => x.from === "[16,2]"),
			"webfig port getall",
		);
		expect(wfPortRow.word).toBe(0x10000007);
		expect(letterKeys(gp)).toEqual(Object.keys(wfPortRow.row).sort());
	});

	test("7.x notifies the originating session; 6.49 does not and tags SYS_ORIGINATOR", () => {
		for (const v of V7) {
			expect(notifies(v, "q1-self-change", "A", "[16,2]").length).toBe(1);
		}
		expect(notifies("6.49", "q1-self-change", "A", "[16,2]")).toEqual([]);
		const [p] = notifies("6.49", "q1-port-comment", "A", "[16,2]");
		const orig = requiredEntry(
			required(p, "6.49 port notify").entries,
			"0xff0012",
			"originator",
		);
		expect(orig.tcode).toBe("0x88");
		expect((orig.value as number[]).slice(2)).toEqual([0, 11]);
	});
});

describe("q2: 0xfe000c selects the status group (bit 0x2)", () => {
	const keyset = (rs: FixtureEntry[][]) =>
		rs.map((r) => letterKeys(r).join(","));

	test.each(
		VERSIONS,
	)("%s: [16,2] words split into config and config+status", (v) => {
		const cfg = keyset(getall(v, "q2-words", "[16,2]", "absent"));
		for (const w of ["0x0", "0x5", "0x10000005"])
			expect(keyset(getall(v, "q2-words", "[16,2]", w))).toEqual(cfg);
		const full = keyset(getall(v, "q2-words", "[16,2]", "0x2"));
		expect(keyset(getall(v, "q2-words", "[16,2]", "0x10000007"))).toEqual(full);
		expect(full).not.toEqual(cfg);
		// Config-only GETALL rows are exactly the CMD_NOTIFY row shape.
		const np = required(
			rows(required(notifies(v, "q1-port-comment", "A", "[16,2]")[0], "np"))[0],
			"np row",
		);
		const p0 = required(getall(v, "q2-words", "[16,2]", "absent")[0], "p0");
		expect(letterKeys(np)).toEqual(letterKeys(p0));
	});

	test.each(VERSIONS)("%s: [20,0] bridge row, no word vs 0x2", (v) => {
		const cfg = named(getall(v, "q2-words", "[20,0]", "absent"), "m2ir-br");
		const full = named(getall(v, "q2-words", "[20,0]", "0x2"), "m2ir-br");
		const ck = letterKeys(cfg);
		const fk = letterKeys(full);
		expect(fk.length).toBeGreaterThan(ck.length);
		expect(ck.every((k) => fk.includes(k))).toBe(true);
		const nb = named(
			rows(required(notifies(v, "q1-bridge-comment", "A", "[20,0]")[0], "nb")),
			"m2ir-br",
		);
		expect(letterKeys(nb)).toEqual(ck);
	});

	test("7.25: 0x5, 0x8 and 0x40000 return the config-only rows", () => {
		const cfg = getall("7.25", "q2-words", "[20,0]", "absent").map((r) =>
			letterKeys(r).join(","),
		);
		for (const w of ["0x5", "0x8", "0x40000"])
			expect(
				getall("7.25", "q2-words", "[20,0]", w).map((r) =>
					letterKeys(r).join(","),
				),
			).toEqual(cfg);
	});
});

describe("q3: UNSUBSCRIBE and subscription bookkeeping", () => {
	test.each(
		VERSIONS,
	)("%s: UNSUBSCRIBE stops notifications for that path", (v) => {
		expect(notifies(v, "q3-unsub-iface", "A")).toEqual([]);
		expect(notifies(v, "q3-port-still-subscribed", "A", "[16,2]").length).toBe(
			1,
		);
		expect(notifies(v, "q3-unsub-port", "A")).toEqual([]);
		expect(notifies(v, "q3-resubscribe", "A", "[16,2]").length).toBe(1);
	});

	test.each(
		VERSIONS,
	)("%s: subscriptions are keyed by path and 0xfe000c word", (v) => {
		// One B change per rung; C's subscription state before the change.
		const ladder: Array<[string, number]> = [
			["q3c-1-sub", 1],
			["q3c-2-sub-again", 1], // plain SUBSCRIBE is idempotent
			["q3c-3-unsub", 0], // one UNSUBSCRIBE removes it
			["q3c-4-unsub-again", 0],
			["q3c-5-sub-word", 1],
			["q3c-6-sub-plain", 2], // word entry + plain entry
			["q3c-7-unsub", 1], // plain UNSUBSCRIBE leaves the word entry
			["q3c-8-unsub-again", 1],
			["q3c-9-unsub-word", 0], // UNSUBSCRIBE with the same word removes it
			["q3c-10-unsub-word-again", 0],
			["q3c-11-sub-word-again", 1],
			["q3c-12-close-session", 0],
		];
		for (const [mark, n] of ladder) {
			expect([mark, notifies(v, mark, "C", "[16,2]").length]).toEqual([
				mark,
				n,
			]);
			expect([mark, notifies(v, mark, "A", "[16,2]").length]).toEqual([
				mark,
				1,
			]);
		}
	});

	test("the SUBSCRIBE word widens every subscriber's rows on 7.x, not on 6.49", () => {
		const size = (v: Version, mark: string, s: string) =>
			rows(
				required(notifies(v, mark, s, "[16,2]")[0], `${v} ${mark} ${s}`),
			).map((r) => r.length)[0];
		for (const v of V7) {
			const cfg = size(v, "q3c-1-sub", "A");
			for (const m of [
				"q3c-5-sub-word",
				"q3c-8-unsub-again",
				"q3c-11-sub-word-again",
			]) {
				expect(size(v, m, "A")).toBeGreaterThan(cfg as number); // A holds only a plain one
				expect(size(v, m, "C")).toBe(size(v, m, "A"));
			}
			for (const m of ["q3c-9-unsub-word", "q3c-12-close-session"])
				expect(size(v, m, "A")).toBe(cfg);
		}
		const cfg6 = size("6.49", "q3c-1-sub", "A");
		for (const m of ["q3c-5-sub-word", "q3c-11-sub-word-again"])
			expect(size("6.49", m, "C")).toBe(cfg6);
	});
});

describe("q4: next-id chain, MOVE and removal on the ordered map [16,2]", () => {
	const order = (rs: FixtureEntry[][]) =>
		rs.map((r) => [val(r, "0xfe0001"), val(r, "0xfe0005")]);

	test.each(
		VERSIONS,
	)("%s: GETALL rows chain by 0xfe0005, last = 0xFFFFFFFF", (v) => {
		const rs = getall(v, "q4-add", "[16,2]", "0x10000007");
		const o = order(rs);
		expect(o.length).toBe(3);
		for (let i = 0; i < o.length; i++) {
			const next = i + 1 < o.length ? (o[i + 1] as unknown[])[0] : 0xffffffff;
			expect((o[i] as unknown[])[1]).toBe(next);
		}
		// The added row is notified alone, appended (next = 0xFFFFFFFF); the
		// old tail's new next-id is not re-sent.
		const added = notifies(v, "q4-add", "A", "[16,2]").flatMap(rows);
		expect(added.length).toBe(1);
		expect(val(required(added[0], "added"), "0xfe0005")).toBe(0xffffffff);
	});

	test.each(
		VERSIONS,
	)("%s: MOVE 0xfe0007 places the row before 0xfe0005", (v) => {
		const before = getall(v, "q4-add", "[16,2]", "0x10000007").map((r) =>
			val(r, "0xfe0001"),
		);
		const after = getall(v, "q4-move-before-first", "[16,2]", "0x10000007").map(
			(r) => val(r, "0xfe0001"),
		);
		const moved = before[2];
		if (v === "6.49") {
			// 6.49 acks the same request but keeps the order.
			expect(after).toEqual(before);
		} else {
			expect(after).toEqual([moved, before[0], before[1]]);
			// Only the moved row is notified, with its new next-id.
			const n = notifies(v, "q4-move-before-first", "A", "[16,2]").flatMap(
				rows,
			);
			expect(n.map((r) => [val(r, "0xfe0001"), val(r, "0xfe0005")])).toEqual([
				[moved, before[0]],
			]);
		}
		// 0xFFFFFFFF ("to end" in WebFig's moveObjectAfter) and a rowid-only
		// MOVE are acked no-ops on every version.
		for (const m of ["q4-move-to-end", "q4-move-rowid-only"])
			expect(
				getall(v, m, "[16,2]", "0x10000007").map((r) => val(r, "0xfe0001")),
			).toEqual(after);
	});

	test.each(VERSIONS)("%s: a removed row is {0xfe0001, 0xfe0013=1}", (v) => {
		const n = required(
			notifies(v, "q4-remove-port", "A", "[16,2]")[0],
			"remove",
		);
		const [row] = rows(n);
		// 0xfe0013 is a u32 (tcode 0x09) = 1, not a bool: WebFig's ufe0013.
		expect(
			required(row, "row")
				.map((e) => [e.key, e.tcode, e.value])
				.sort(),
		).toEqual([
			["0xfe0001", "0x9", 2],
			["0xfe0013", "0x9", 1],
		]);
		expect(val(n.entries, "0xfe0019")).toBe(2);
	});
});

describe("schema records the step 4 findings", () => {
	test("std-commands and std-keys cite the native fixtures", () => {
		const cmds = loadYamlDoc<{
			commands: Record<string, Record<string, unknown>>;
		}>("profiles/winbox-ipc/std-commands.yaml");
		const keys = loadYamlDoc<{ keys: Record<string, Record<string, unknown>> }>(
			"profiles/winbox-ipc/std-keys.yaml",
		);
		for (const code of [0xfe000b, 0xfe0012, 0xfe0013, 0xfe0007]) {
			const c = required(cmds.commands[String(code)], `command ${code}`);
			expect(JSON.stringify(c)).toContain("native-bridge-workflow.json");
		}
		for (const code of [0xfe000c, 0xfe0005, 0xfe0013]) {
			const k = required(keys.keys[String(code)], `key ${code}`);
			expect(JSON.stringify(k)).toContain("native-bridge-workflow.json");
		}
	});
});
