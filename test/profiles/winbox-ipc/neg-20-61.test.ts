// [20,61] GET-family negatives replay (6.49.23 + 7.25 + 7.26beta4).
//
// The schema entry under test lives in
// profiles/winbox-ipc/gui-handlers.yaml (modem-aux-20-61); error names
// come from profiles/winbox-ipc/std-errors.yaml. The wire bytes live in
// fixtures/winbox-ipc/{6.49,7.25,7.26beta4}-neg-20-61.json: GET
// bare/f7/f999 negatives, GETALL/GETOBJ gating, GETCOUNT ok —
// sanitized from the queue-3 cap5 manifests.
//
// CHR-absent handler (no modem hardware): every leg is a negative probe
// except GETCOUNT, which answers ok + 0xFFFFFFFF. First v6 transcripts
// (prior v6 legs were observation-only).
//
// Rule: expected names come from the YAML, never from hardcoded labels. The
// mini parser (./m2-replay.ts) is independent of the work/ harness decoder.

import { describe, expect, test } from "bun:test";
import {
	decodeFixtureEntries,
	type FixtureEntry,
	findEntry,
	loadFixture,
	loadYamlDoc,
	required,
	requiredEntry,
} from "./m2-replay";

interface GuiHandlersDoc {
	handlers: Record<
		string,
		{ role?: string; notes?: string; "sys-to"?: number[] }
	>;
}

interface StdErrorsDoc {
	errors: Record<string, { "canonical-name"?: string }>;
}

const V6 = "6.49-neg-20-61.json";
const V7 = ["7.25-neg-20-61.json", "7.26beta4-neg-20-61.json"] as const;
const ALL = [V6, ...V7] as const;

const UNKNOWNID = 0xfe0004;
const NOTIMP = 0xfe0003;

function recordById(name: string, id: string) {
	const fixture = loadFixture(name);
	return required(
		fixture.records.find((r) => r.id === id),
		`${name} ${id}`,
	);
}

function errnoOf(entries: FixtureEntry[]): number {
	return requiredEntry(entries, "0xff0008", "SYS_ERRNO").value as number;
}

describe("neg [20,61] replay", () => {
	test("schema binds modem-aux-20-61 + UNKNOWNID/NOTIMP names", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const entry = required(gui.handlers["modem-aux-20-61"], "modem-aux-20-61");
		expect(entry["sys-to"]).toEqual([20, 61]);
		expect(required(entry.role, "modem-aux role")).toContain("0xFFFFFFFF");
		expect(required(entry.notes, "modem-aux notes")).toContain("f999");

		const errors = loadYamlDoc<StdErrorsDoc>(
			"profiles/winbox-ipc/std-errors.yaml",
		);
		expect(
			required(errors.errors[String(UNKNOWNID)], "0xfe0004")["canonical-name"],
		).toBe("ERROR_UNKNOWNID");
		expect(
			required(errors.errors[String(NOTIMP)], "0xfe0003")["canonical-name"],
		).toBe("ERROR_NOTIMP");
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

	test("GET bare/f7/f999 miss with UNKNOWNID, no total/errstr/rows", () => {
		const legs = [
			"neg-20-61-get-bare",
			"neg-20-61-get-f7-lte1",
			"neg-20-61-get-f7-foo",
			"neg-20-61-get-unknown-f999-u32",
		];
		for (const name of ALL) {
			for (const stem of legs) {
				const rx = decodeFixtureEntries(recordById(name, `${stem}-rx`).hex);
				expect(errnoOf(rx)).toBe(UNKNOWNID);
				expect(requiredEntry(rx, "0xff0002", "SYS_FROM").value).toEqual([
					20, 61,
				]);
				expect(findEntry(rx, "0xfe0019")).toBeUndefined();
				expect(findEntry(rx, "0xfe0014")).toBeUndefined();
				expect(findEntry(rx, "0xff0009")).toBeUndefined();
				expect(findEntry(rx, "0xfe0002")).toBeUndefined();
			}
		}
	});

	test("probe tx bytes genuinely differ per selector", () => {
		for (const name of ALL) {
			const bare = recordById(name, "neg-20-61-get-bare-tx");
			const lte1 = recordById(name, "neg-20-61-get-f7-lte1-tx");
			const foo = recordById(name, "neg-20-61-get-f7-foo-tx");
			const f999 = recordById(name, "neg-20-61-get-unknown-f999-u32-tx");
			// Bare carries no USER-namespace extras.
			expect(
				decodeFixtureEntries(bare.hex).filter((e) =>
					e.key.startsWith("0x00000"),
				).length,
			).toBe(0);
			// f7 selectors arrive as compact strings; f999 as compact u32.
			expect(
				requiredEntry(decodeFixtureEntries(lte1.hex), "0x000007", "f7").value,
			).toBe("lte1");
			expect(
				requiredEntry(decodeFixtureEntries(foo.hex), "0x000007", "f7").value,
			).toBe("foo");
			const f999entries = decodeFixtureEntries(f999.hex);
			expect(requiredEntry(f999entries, "0x0003e7", "f999").value).toBe(1);
			expect(requiredEntry(f999entries, "0x0003e7", "f999").tcode).toBe("0x9");
		}
	});

	test("GETALL gating is version-divided, GETOBJ is NOTIMP", () => {
		for (const name of V7) {
			const rx = decodeFixtureEntries(
				recordById(name, "neg-20-61-getall-bare-rx").hex,
			);
			expect(errnoOf(rx)).toBe(NOTIMP);
		}
		const v6rx = decodeFixtureEntries(
			recordById(V6, "neg-20-61-getall-bare-rx").hex,
		);
		expect(errnoOf(v6rx)).toBe(UNKNOWNID);

		for (const name of ALL) {
			for (const stem of [
				"neg-20-61-getobj-obj-1",
				"neg-20-61-getobj-obj-999",
			]) {
				const rx = decodeFixtureEntries(recordById(name, `${stem}-rx`).hex);
				expect(errnoOf(rx)).toBe(NOTIMP);
				expect(requiredEntry(rx, "0xff0002", "SYS_FROM").value).toEqual([
					20, 61,
				]);
			}
			// GETOBJ tx row-id encoding: compact for 1, wide for 999.
			const obj1tx = decodeFixtureEntries(
				recordById(name, "neg-20-61-getobj-obj-1-tx").hex,
			);
			expect(requiredEntry(obj1tx, "0xfe0001", "row-id").tcode).toBe("0x9");
			const obj999tx = decodeFixtureEntries(
				recordById(name, "neg-20-61-getobj-obj-999-tx").hex,
			);
			const wide = requiredEntry(obj999tx, "0xfe0001", "row-id");
			expect(wide.tcode).toBe("0x8");
			expect(wide.value).toBe(999);
		}
	});

	test("GETCOUNT answers ok + 0xFFFFFFFF in the version slot", () => {
		const v6rx = recordById(V6, "neg-20-61-getcount-bare-rx");
		const v6entries = decodeFixtureEntries(v6rx.hex);
		expect(findEntry(v6entries, "0xff0008")).toBeUndefined();
		expect(requiredEntry(v6entries, "0xfe0014", "STD_COUNT").value).toBe(
			0xffffffff,
		);
		expect(findEntry(v6entries, "0xfe0019")).toBeUndefined();
		// Byte-level, independent of the decoder.
		expect(v6rx.hex).toContain("1400fe08ffffffff");
		expect(v6rx.hex).not.toContain("1900fe");

		for (const name of V7) {
			const rx = recordById(name, "neg-20-61-getcount-bare-rx");
			const entries = decodeFixtureEntries(rx.hex);
			expect(findEntry(entries, "0xff0008")).toBeUndefined();
			expect(requiredEntry(entries, "0xfe0019", "STD_OBJ_COUNT").value).toBe(
				0xffffffff,
			);
			expect(findEntry(entries, "0xfe0014")).toBeUndefined();
			expect(rx.hex).toContain("1900fe08ffffffff");
			expect(rx.hex).not.toContain("1400fe");
		}
	});
});
