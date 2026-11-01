// NAT/RAW empty-table replay (6.49.23 + 7.25 + 7.26beta4).
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (nat-20-5, raw-20-87) and
// profiles/winbox-ipc/std-keys.yaml (0xfe0002 STD_OBJS). The wire bytes
// live in fixtures/winbox-ipc/{6.49,7.25,7.26beta4}-nat-raw-f40.json:
// empty-table GETALL/GETCOUNT/GETOBJ on [20,5] + [20,87] — sanitized
// from the queue-3 cap7 manifests.
//
// Both tables are empty on every machine (REST agrees): empty lists
// carry 0xfe0002/0xa8=[] PRESENT plus total 0. f40 (action) stays
// UNOBSERVED read-only — the tests pin the negative, not a value enum.
//
// Rule: expected names come from the YAML, never from hardcoded labels. The
// mini parser (./m2-replay.ts) is independent of the work/ harness decoder.

import { describe, expect, test } from "bun:test";
import {
	decodeFixtureEntries,
	findEntry,
	loadFixture,
	loadYamlDoc,
	required,
	requiredEntry,
	rowsOf,
} from "./m2-replay";

interface GuiHandlersDoc {
	handlers: Record<
		string,
		{
			"sys-to"?: number[];
			fields?: { "namespace-user"?: Record<string, { name: string }> };
		}
	>;
}

interface StdKeysDoc {
	keys: Record<string, { "canonical-name"?: string; role?: string }>;
}

const V6 = "6.49-nat-raw-f40.json";
const V7 = ["7.25-nat-raw-f40.json", "7.26beta4-nat-raw-f40.json"] as const;
const ALL = [V6, ...V7] as const;

const UNKNOWNID = 0xfe0004;

function recordById(name: string, id: string) {
	const fixture = loadFixture(name);
	return required(
		fixture.records.find((r) => r.id === id),
		`${name} ${id}`,
	);
}

describe("nat/raw empty replay", () => {
	test("schema binds nat-20-5 + raw-20-87 + STD_OBJS + f40", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const nat = required(gui.handlers["nat-20-5"], "nat-20-5");
		expect(nat["sys-to"]).toEqual([20, 5]);
		const raw = required(gui.handlers["raw-20-87"], "raw-20-87");
		expect(raw["sys-to"]).toEqual([20, 87]);
		for (const entry of [nat, raw]) {
			const user = required(entry.fields?.["namespace-user"], "namespace-user");
			expect(required(user["40"], "f40").name).toBe("action");
		}

		const std = loadYamlDoc<StdKeysDoc>("profiles/winbox-ipc/std-keys.yaml");
		expect(
			required(std.keys[String(0xfe0002)], "0xfe0002")["canonical-name"],
		).toBe("STD_OBJS");
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		for (const name of ALL) {
			const fixture = loadFixture(name);
			expect(fixture.records.length).toBe(16);
			for (const record of fixture.records) {
				expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
			}
		}
	});

	test("empty GETALL carries 0xfe0002=[] plus total 0, all versions", () => {
		for (const name of ALL) {
			for (const stem of ["nat-getall-bare", "raw-getall-bare"]) {
				const record = recordById(name, `${stem}-rx`);
				const rx = decodeFixtureEntries(record.hex);
				expect(findEntry(rx, "0xff0008")).toBeUndefined();
				const rows = requiredEntry(rx, "0xfe0002", "STD_OBJS");
				expect(rows.tcode).toBe("0xa8");
				expect(rowsOf(rows)).toEqual([]);
				expect(requiredEntry(rx, "0xfe0019", "STD_OBJ_COUNT").value).toBe(0);
				// Byte-level, independent of the decoder.
				expect(record.hex).toContain("0200fea80000");
				expect(record.hex).toContain("1900fe0900");
			}
		}
	});

	test("GETCOUNT division holds on [20,5] + [20,87]", () => {
		for (const stem of ["nat-getcount-bare", "raw-getcount-bare"]) {
			const v6rx = recordById(V6, `${stem}-rx`);
			const v6entries = decodeFixtureEntries(v6rx.hex);
			expect(requiredEntry(v6entries, "0xfe0014", "STD_COUNT").value).toBe(0);
			expect(findEntry(v6entries, "0xfe0019")).toBeUndefined();
			expect(v6rx.hex).toContain("1400fe0900");

			for (const name of V7) {
				const rx = recordById(name, `${stem}-rx`);
				const entries = decodeFixtureEntries(rx.hex);
				expect(requiredEntry(entries, "0xfe0019", "STD_OBJ_COUNT").value).toBe(
					0,
				);
				expect(findEntry(entries, "0xfe0014")).toBeUndefined();
				expect(rx.hex).toContain("1900fe0900");
			}
		}
	});

	test("GETOBJ on empty tables is UNKNOWNID without total", () => {
		for (const name of ALL) {
			for (const stem of [
				"nat-getobj-obj-1",
				"nat-getobj-obj-999",
				"raw-getobj-obj-1",
				"raw-getobj-obj-999",
			]) {
				const rx = decodeFixtureEntries(recordById(name, `${stem}-rx`).hex);
				expect(requiredEntry(rx, "0xff0008", "SYS_ERRNO").value).toBe(
					UNKNOWNID,
				);
				expect(findEntry(rx, "0xfe0019")).toBeUndefined();
				expect(findEntry(rx, "0xfe0014")).toBeUndefined();
				expect(findEntry(rx, "0xfe0002")).toBeUndefined();
			}
		}
	});

	test("f40 appears nowhere: UNOBSERVED read-only negative", () => {
		for (const name of ALL) {
			const fixture = loadFixture(name);
			let checked = 0;
			for (const record of fixture.records) {
				for (const entry of decodeFixtureEntries(record.hex)) {
					expect(entry.key).not.toBe("0x000028");
					checked++;
				}
				expect(record.hex).not.toContain("280000");
			}
			expect(checked).toBeGreaterThan(0);
		}
	});
});
