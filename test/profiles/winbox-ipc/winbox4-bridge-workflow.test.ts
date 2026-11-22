// Plan step 5: WinBox 4.4 running the Bridge workflow through the
// decrypting proxy (work/2026-11-jg-descriptors/winbox4/), checked
// against the WebFig (step 3) and native (step 4) fixtures.
//
// The offline check rebuilds the Bridge Ports list each client displays
// (row order and comments) from the M2 messages alone, using
// work/2026-11-jg-descriptors/winbox4/list-model.ts, and checks every
// list read against what the earlier state plus notifications predicted.
// Messages are decoded with the independent mini parser (./m2-replay.ts).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	type ListEvent,
	type Replay,
	type RowUpdate,
	replay,
	shownAt,
} from "../../../work/2026-11-jg-descriptors/winbox4/list-model";
import { findEntry, repoPath } from "./m2-replay";
import { entryEvents, loadDecoded, PORT } from "./winbox4-events";

const GETALL = 0xfe0004;
const NOTIFY = 0xfe000b;
const SUBSCRIBE = 0xfe0012;
const UNSUBSCRIBE = 0xfe0013;
const MOVEOBJ = 0xfe0007;

/** WebFig transcript: letter-keyed messages. */
type Letters = Record<string, unknown>;
interface WebfigLine {
	seq: number;
	t: number;
	dir?: string;
	mark?: string;
	msg?: Letters;
}
function webfigEvents(lines: WebfigLine[]): ListEvent[] {
	const out: ListEvent[] = [];
	const upd = (row: Letters): RowUpdate => ({
		id: row["ufe0001"] as number,
		...(typeof row["ufe0005"] === "number"
			? { next: row["ufe0005"] as number }
			: {}),
		...(typeof row["sfe0009"] === "string"
			? { comment: row["sfe0009"] as string }
			: {}),
		...(row["ufe0013"] === 1 ? { removed: true } : {}),
	});
	for (const l of lines) {
		const m = l.msg;
		if (!m) continue;
		if (l.dir !== "rx" || JSON.stringify(m["Uff0002"]) !== PORT) continue;
		const rows = m["Mfe0002"] as Letters[] | undefined;
		if (m["uff0007"] === NOTIFY) {
			out.push({
				tMs: l.t,
				kind: "notify",
				rows: (rows ?? []).map(upd),
				ref: `seq ${l.seq}`,
			});
			continue;
		}
		// The transcript's tx messages carry no request id, but the only
		// [16,2] reads WebFig makes are GETALLs. A reply without Mfe0002
		// (SUBSCRIBE acks, /jsproxy polls with no rows) is not a list read.
		if (!rows) continue;
		out.push({
			tMs: l.t,
			kind: "list",
			rows: rows.map(upd),
			ref: `seq ${l.seq}`,
		});
	}
	return out;
}

const wb = loadDecoded("7.25-winbox4-bridge-workflow.json");
const native = loadDecoded("7.25-native-bridge-workflow.json");
const webfigLines = readFileSync(
	repoPath("fixtures/winbox-ipc/7.25-webfig-bridge-workflow.jsonl"),
	"utf8",
)
	.trim()
	.split("\n")
	.map((l) => JSON.parse(l) as WebfigLine);

type Timeline = Array<{
	tMs: number;
	mark?: string;
	action?: string;
	comment?: string;
}>;
const timeline = wb.prov["timeline"] as Timeline;
const at = (pred: (x: Timeline[number]) => boolean): number => {
	const hit = timeline.find(pred);
	if (!hit) throw new Error("timeline entry missing");
	return hit.tMs;
};
const wbPort = (cmd: number) =>
	wb.recs.filter((r) => r.cmd === cmd && JSON.stringify(r.to) === PORT);

describe("WinBox 4.4 Bridge workflow (plan step 5, 7.25)", () => {
	const rp: Replay = replay(entryEvents(wb.recs, "W"));
	const comments = (t: number) => shownAt(rp, t)?.comments;

	test("provenance records client, router, packages, .jg names and method", () => {
		const client = wb.prov["client"] as Record<string, string>;
		expect(client["version"]).toContain("4.4");
		expect(wb.prov["routeros_version"]).toBe("7.25");
		expect(String(wb.prov["capture_method"])).toContain("proxy.ts");
		// Same descriptor set as the WebFig run on the same build.
		const webfigProv = (
			JSON.parse(webfigLines[0] ? JSON.stringify(webfigLines[0]) : "{}") as {
				provenance: { jg_unique_names: string[] };
			}
		).provenance;
		expect(wb.prov["jg_unique_names"]).toEqual(webfigProv.jg_unique_names);
	});

	test("rebuilt display follows every step of the workflow", () => {
		expect(rp.states.length).toBeGreaterThan(0);
		const open1 = at((x) => x.mark?.startsWith("ui-1") === true);
		expect(comments(open1)).toEqual(["m2ir-p1", "m2ir-p2"]);
		const c1 = at((x) => x.comment === "m2ir-p1-c1");
		expect(comments(c1 + 1000)).toEqual(["m2ir-p1-c1", "m2ir-p2"]);
		const ui3 = at((x) => x.mark?.startsWith("ui-3") === true);
		expect(comments(ui3)).toEqual(["m2ir-p2", "m2ir-p1-c2"]);
		const last = rp.states.at(-1)?.shown;
		expect(last?.comments).toEqual(["m2ir-p2", "m2ir-p1-c2"]);
		expect(last?.ids).toEqual([1, 0]);
	});

	test("notifications alone predict every list read", () => {
		expect(rp.mismatches).toEqual([]);
	});

	test("the window-open comment change arrives as CMD_NOTIFY before the next poll", () => {
		const c1 = at((x) => x.comment === "m2ir-p1-c1");
		const n = rp.states.find((s) => s.ev.kind === "notify" && s.ev.tMs > c1);
		expect(n?.ev.rows).toEqual([
			expect.objectContaining({ id: 0, comment: "m2ir-p1-c1" }),
		]);
		expect((n?.ev.tMs ?? 0) - c1).toBeLessThan(1000);
	});

	test("closing the window unsubscribes and stops the poll; nothing arrives while closed", () => {
		const unsub = wbPort(UNSUBSCRIBE);
		const sub = wbPort(SUBSCRIBE);
		expect(unsub.length).toBe(3);
		expect(sub.length).toBe(3);
		for (const r of [...unsub, ...sub])
			expect(findEntry(r.all, "0xfe000c")?.value).toBe(0x10000007);
		const closed = unsub[0]?.tMs ?? 0;
		const reopened = sub[1]?.tMs ?? 0;
		const between = wb.recs.filter(
			(r) =>
				r.tMs > closed &&
				r.tMs < reopened &&
				(JSON.stringify(r.to) === PORT || JSON.stringify(r.from) === PORT),
		);
		expect(between).toEqual([]);
		// The change made while closed shows on reopen, from the first read.
		expect(comments(reopened + 50)).toEqual(["m2ir-p1-c2", "m2ir-p2"]);
	});

	test("timed GETALL every 2 s with the SUBSCRIBE word while open", () => {
		const polls = wbPort(GETALL).filter(
			(r) => findEntry(r.all, "0xfe000c")?.value === 0x10000007,
		);
		const gaps = polls
			.slice(1)
			.map((r, i) => r.tMs - (polls[i]?.tMs ?? 0))
			.filter((g) => g < 2500);
		const sorted = [...gaps].sort((a, b) => a - b);
		const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
		expect(median).toBeGreaterThan(1900);
		expect(median).toBeLessThan(2100);
	});

	test("MOVE: WinBox sends {0xfe000c, 0xfe0001, 0xfe0005=before-id}; [17] records the same", () => {
		const [mv] = wbPort(MOVEOBJ);
		expect(mv).toBeDefined();
		const keys = (mv?.all ?? []).filter((e) => !e.key.startsWith("0xff"));
		expect(keys.map((e) => [e.key, e.value])).toEqual([
			["0xfe000c", 0x10000007],
			["0xfe0001", 1],
			["0xfe0005", 0],
		]);
		const hist = (
			wb.prov["history_winbox"] as Array<{ m1: Record<string, unknown> }>
		)[0]?.m1;
		expect(hist?.["uff0007"]).toBe(MOVEOBJ);
		expect([hist?.["ufe0001"], hist?.["ufe0005"], hist?.["ufe000c"]]).toEqual([
			1, 0, 0x10000007,
		]);
		// Only the moved row is notified, and the display reorders from it.
		const n = rp.states.find(
			(s) => s.ev.kind === "notify" && s.ev.tMs > (mv?.tMs ?? 0),
		);
		expect(n?.ev.rows.map((r) => [r.id, r.next])).toEqual([[1, 0]]);
		expect(n?.shown.ids).toEqual([1, 0]);
	});
});

describe("the same offline check on the WebFig and native fixtures (7.25)", () => {
	test("WebFig: notifications predict every list read; display follows the REST comments", () => {
		const rp = replay(webfigEvents(webfigLines));
		expect(rp.mismatches).toEqual([]);
		const seen = rp.states.map((s) => s.shown.comments.join("|"));
		expect([...new Set(seen)]).toEqual(["port-a", "port-b", "port-c", ""]);
	});

	test("native session A: notifications predict every list read, MOVE reorders", () => {
		const rp = replay(entryEvents(native.recs, "A"));
		expect(rp.mismatches).toEqual([]);
		const orders = rp.states.map((s) => s.shown.ids.join(","));
		expect(orders).toContain("2,0,1");
	});
});
