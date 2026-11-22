// Step 5 follow-up: SYS_SNAPSHOT 0xff0017 on CMD_SUBSCRIBE (sys-keys.yaml).
// The native probe (work/2026-11-jg-descriptors/winbox4/first-notify.ts)
// ran each variant in its own login on 7.25; this test decodes every
// record with the independent mini parser and checks the rule: a
// SUBSCRIBE with 0xff0017=true that adds a new (session, path, word)
// subscription is answered by one NOTIFY with every row; nothing else
// produces that NOTIFY.

import { describe, expect, test } from "bun:test";
import { findEntry, rowsOf } from "./m2-replay";
import { type Decoded, loadDecoded } from "./winbox4-events";

const GETALL = 0xfe0004;
const NOTIFY = 0xfe000b;
const SUBSCRIBE = 0xfe0012;
const UNSUBSCRIBE = 0xfe0013;

const fx = loadDecoded("7.25-native-subscribe-snapshot.json");
const marks = [...new Set(fx.recs.map((r) => r.mark))];
const ofMark = (m: string) => fx.recs.filter((r) => r.mark === m);
const isTx = (r: Decoded) => r.role.endsWith(", tx");
const wordOf = (r: Decoded) => {
	const w = findEntry(r.all, "0xfe000c")?.value;
	return typeof w === "number" ? w : null;
};
const rowKeys = (r: Decoded | undefined): string[][] => {
	const e = r ? findEntry(r.all, "0xfe0002") : undefined;
	return e ? rowsOf(e).map((row) => row.map((x) => x.key).sort()) : [];
};

/** Per transmitted message: the NOTIFYs that arrived before the next tx. */
function steps(m: string): Array<{ tx: Decoded; notifies: Decoded[] }> {
	const out: Array<{ tx: Decoded; notifies: Decoded[] }> = [];
	for (const r of ofMark(m)) {
		if (isTx(r)) out.push({ tx: r, notifies: [] });
		else if (r.cmd === NOTIFY) out.at(-1)?.notifies.push(r);
	}
	return out;
}

describe("SUBSCRIBE snapshot (0xff0017), native 7.25", () => {
	test("fixture covers 22 variant x path runs on [16,2] and [20,0]", () => {
		expect(fx.prov["routeros_version"]).toBe("7.25");
		expect(marks.length).toBe(42);
		expect(marks.filter((m) => m.endsWith("[16,2]")).length).toBe(21);
	});

	test("a NOTIFY follows exactly the new subscriptions that carry 0xff0017", () => {
		let snapshots = 0;
		for (const m of marks) {
			const live = new Set<number | null>();
			for (const { tx, notifies } of steps(m)) {
				let expected = 0;
				if (tx.cmd === SUBSCRIBE) {
					const w = wordOf(tx);
					const flag = findEntry(tx.all, "0xff0017")?.value === true;
					if (flag && !live.has(w)) expected = 1;
					live.add(w);
				}
				if (tx.cmd === UNSUBSCRIBE) live.delete(wordOf(tx));
				expect({ m, role: tx.role, n: notifies.length }).toEqual({
					m,
					role: tx.role,
					n: expected,
				});
				for (const n of notifies) {
					expect(n.from).toEqual(tx.to);
					expect(n.to).toEqual(tx.from);
				}
				snapshots += expected;
			}
		}
		// e2, e4-e9 (e8 twice) on both paths.
		expect(snapshots).toBe(16);
	});

	test("defaults GETALL, GETPOLICIES or another FROM handler alone give no snapshot", () => {
		for (const m of marks.filter((x) => x.startsWith("v"))) {
			for (const { notifies } of steps(m)) expect(notifies).toEqual([]);
		}
	});

	test("snapshot rows carry the groups the word selects, like GETALL with it", () => {
		for (const path of ["[16,2]", "[20,0]"]) {
			const getall = ofMark(`e10-getall17${path}`).find(
				(r) => !isTx(r) && r.reqId !== null && findEntry(r.all, "0xfe0002"),
			);
			const viaGetall = rowKeys(getall);
			expect(viaGetall.length).toBeGreaterThan(0);
			const worded = steps(`e2-nr17-12${path}`)[0]?.notifies[0];
			expect(rowKeys(worded)).toEqual(viaGetall);
			// Without a word the snapshot has a strict subset of those keys;
			// on [16,2] that is the config group (no f200+ status keys).
			const plain = rowKeys(steps(`e7-sub0-17${path}`)[0]?.notifies[0]);
			expect(plain.length).toBe(viaGetall.length);
			for (const [i, keys] of plain.entries()) {
				const full = viaGetall[i] ?? [];
				expect(keys.length).toBeLessThan(full.length);
				for (const k of keys) expect(full).toContain(k);
				if (path === "[16,2]")
					for (const k of keys) {
						const n = Number.parseInt(k, 16);
						expect(n < 0xc8 || n >= 0xfe0000).toBe(true);
					}
			}
		}
	});

	test("GETALL ignores 0xff0017 (a normal reply, no NOTIFY)", () => {
		for (const path of ["[16,2]", "[20,0]"]) {
			const s = steps(`e10-getall17${path}`);
			expect(s.map((x) => x.tx.cmd)).toEqual([GETALL]);
			expect(s[0]?.notifies).toEqual([]);
		}
	});
});
