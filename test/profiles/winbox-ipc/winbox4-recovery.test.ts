// Step 5 follow-up: WinBox 4.4 recovery cases through the decrypting proxy
// (work/2026-11-jg-descriptors/winbox4/, README "WinBox 4 recovery cases"):
// R1 a write the router rejects, R2 a row removed while its edit dialog is
// open, R3 a dropped connection with changes made while WinBox was away.
// Messages are decoded with the independent mini parser (./m2-replay.ts);
// the display is rebuilt with work/2026-11-jg-descriptors/winbox4/list-model.ts.

import { describe, expect, test } from "bun:test";
import {
	replay,
	shownAt,
} from "../../../work/2026-11-jg-descriptors/winbox4/list-model";
import { findEntry, rowsOf } from "./m2-replay";
import {
	type Decoded,
	entryEvents,
	loadDecoded,
	PORT,
	rowUpdate,
} from "./winbox4-events";

const GETOBJ = 0xfe0002;
const SETOBJ = 0xfe0003;
const GETALL = 0xfe0004;
const NOTIFY = 0xfe000b;
const GETPOLICIES = 0xfe0001;
const SUBSCRIBE = 0xfe0012;
const ERROR_UNKNOWNID = 0xfe0004;
const ERROR_FAILED = 0xfe0006;

const fx = loadDecoded("7.25-winbox4-recovery.json");
const recs = fx.recs;
const v = (r: Decoded | undefined, k: string) =>
	r ? findEntry(r.all, k)?.value : undefined;
const toPort = (r: Decoded) => JSON.stringify(r.to) === PORT;
const fromPort = (r: Decoded) => JSON.stringify(r.from) === PORT;
const replyTo = (tx: Decoded) =>
	recs.find(
		(r) =>
			r.session === tx.session &&
			r.reqId === tx.reqId &&
			r.tMs >= tx.tMs &&
			!r.role.endsWith(", tx"),
	);
type Timeline = Array<{ tMs: number; mark?: string; action?: string }>;
const timeline = fx.prov["timeline"] as Timeline;
const at = (pred: (x: Timeline[number]) => boolean): number => {
	const hit = timeline.find(pred);
	if (!hit) throw new Error("timeline entry missing");
	return hit.tMs;
};

describe("WinBox 4.4 recovery cases (7.25)", () => {
	test("two connections: the proxy drop, then WinBox's own login", () => {
		expect(fx.prov["routeros_version"]).toBe("7.25");
		const ev = (fx.prov["connection_events"] as Array<{ event: string }>).map(
			(e) => e.event,
		);
		expect(ev).toEqual([
			"accept",
			"phase2",
			"drop",
			"close",
			"accept",
			"phase2",
			"proxy-stop",
		]);
		expect([...new Set(recs.map((r) => r.session))]).toEqual(["W1", "W2"]);
		// Same build and descriptor set as the step 5 run.
		const step5 = loadDecoded("7.25-winbox4-bridge-workflow.json").prov;
		expect(fx.prov["jg_unique_names"]).toEqual(step5["jg_unique_names"]);
		expect(fx.prov["client"]).toEqual(step5["client"]);
	});

	test("R1: one SETOBJ per OK/Apply, whole config record, ERROR_FAILED + errstr", () => {
		const sets = recs.filter((r) => r.cmd === SETOBJ && toPort(r));
		expect(sets.length).toBe(2);
		for (const s of sets) {
			expect(v(s, "0xfe0001")).toBe(0);
			const keys = s.all
				.map((e) => Number.parseInt(e.key, 16))
				.filter((k) => k < 0xff0000);
			expect(keys.length).toBe(35);
			// Below f200 plus two status-tab fields the 7.25 .jg declares as
			// hidden non-read-only numbers: uc8 role and ud0 status
			// (nonpublic:1); no other f200+ key.
			expect(
				keys.filter((k) => k >= 0xc8 && k < 0xfe0000).sort((a, b) => a - b),
			).toEqual([0xc8, 0xd0]);
			// The interface (f3) differs from the row's stored value.
			const before = recs
				.filter(
					(r) =>
						r.tMs < s.tMs &&
						fromPort(r) &&
						v(r, "0xfe0001") === 0 &&
						v(r, "0x000003") !== undefined,
				)
				.at(-1);
			expect(v(s, "0x000003")).not.toBe(v(before, "0x000003"));
			const rep = replyTo(s);
			expect(v(rep, "0xff0008")).toBe(ERROR_FAILED);
			expect(v(rep, "0xff0009")).toBe("device already added as bridge port");
		}
		// The list display never changed during R1.
		const rp = replay(entryEvents(recs, "W1"));
		expect(
			shownAt(
				rp,
				at((x) => x.mark?.startsWith("ui-r1:") === true),
			)?.comments,
		).toEqual(["m2ir-p1", "m2ir-p2"]);
	});

	test("edit dialog reads its row with GETOBJ every 1 s from the list's handler", () => {
		const sub = recs.find((r) => r.cmd === SUBSCRIBE && toPort(r));
		const gets = recs.filter((r) => r.cmd === GETOBJ && toPort(r));
		expect(gets.length).toBeGreaterThan(0);
		for (const g of gets) {
			expect(g.from).toEqual(sub?.from ?? null);
			expect(v(g, "0xfe000c")).toBe(0x10000007);
		}
		const periods = fx.prov["poll_periods"] as Record<
			string,
			{ median_ms: number }
		>;
		expect(periods["W1 [16,2] GETOBJ"]?.median_ms).toBe(1000);
		expect(periods["W1 [16,2] GETALL"]?.median_ms).toBe(2000);
	});

	test("R2: row removed under an open dialog -> GETOBJ UNKNOWNID, removal NOTIFY, reads stop", () => {
		const removed = at((x) => x.action === "remove");
		const row1 = recs.filter(
			(r) => r.cmd === GETOBJ && toPort(r) && v(r, "0xfe0001") === 1,
		);
		const last = row1.at(-1);
		expect(last).toBeDefined();
		expect((last?.tMs ?? 0) - removed).toBeGreaterThan(0);
		expect((last?.tMs ?? 0) - removed).toBeLessThan(1000);
		const rep = last ? replyTo(last) : undefined;
		expect(v(rep, "0xff0008")).toBe(ERROR_UNKNOWNID);
		expect(v(rep, "0xff0009")).toBeUndefined();
		const n = recs.find(
			(r) => r.cmd === NOTIFY && fromPort(r) && r.tMs > (last?.tMs ?? 0),
		);
		const rows = n
			? rowsOf(
					findEntry(n.all, "0xfe0002") ?? { key: "", tcode: "", value: [] },
				).map(rowUpdate)
			: [];
		expect(rows).toEqual([{ id: 1, removed: true }]);
		// Every earlier dialog read of row 1 succeeded; none after the error.
		for (const g of row1.slice(0, -1))
			expect(v(replyTo(g), "0xff0008")).toBeUndefined();
	});

	test("R3: reconnect replays first open under the same handler and rebuilds from the snapshot", () => {
		const w1sub = recs.find(
			(r) => r.session === "W1" && r.cmd === SUBSCRIBE && toPort(r),
		);
		const w2 = recs.filter((r) => r.session === "W2" && toPort(r));
		const firstOpen = w2.slice(0, 3).map((r) => r.cmd);
		expect(firstOpen).toEqual([GETALL, GETPOLICIES, SUBSCRIBE]);
		expect(v(w2[0], "0xfe000c")).toBe(0x20000000);
		const sub = w2[2];
		expect(sub?.from).toEqual(w1sub?.from ?? null);
		expect(v(sub, "0xff0017")).toBe(true);
		expect(v(sub, "0xfe000c")).toBe(0x10000007);

		// One display across both connections: the snapshot is the first
		// read after the drop, and it shows the changes made while away
		// (comment m2ir-r3, port *2 gone) without any removal row.
		const rp = replay(
			entryEvents(recs, ["W1", "W2"], { snapshotIsList: true }),
		);
		expect(rp.mismatches).toEqual([]);
		const drop = at((x) => x.action === "drop");
		expect(shownAt(rp, drop - 1)?.comments).toEqual(["m2ir-p1", "m2ir-p2"]);
		const ui = at((x) => x.mark?.startsWith("ui-r3") === true);
		expect(shownAt(rp, ui)).toEqual({ ids: [0], comments: ["m2ir-r3"] });
		const snap = rp.states.find((s) => s.ev.kind === "list" && s.ev.tMs > drop);
		expect(snap?.ev.ref).toContain("W2");
		expect(snap?.ev.rows).toEqual([
			expect.objectContaining({ id: 0, comment: "m2ir-r3" }),
		]);
	});
});
