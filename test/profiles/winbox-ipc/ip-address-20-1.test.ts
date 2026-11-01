// Ip-address [20,1] bare-GETALL replay (6.49.23 + 7.25, total = 1).
//
// The schema entry under test lives in profiles/winbox-ipc/std-keys.yaml
// (0xfe0019 STD_OBJ_COUNT: =1 on [20,1] both versions). The wire bytes
// live in fixtures/winbox-ipc/{6.49,7.25}-getall-20-1.json, sanitized
// from work/2026-10-chr-extraction/ws3c/ev/{6.49,7.25}-getall-20-1.json.
//
// Bare replies only: the validated-cursor legs (s=0/999 -> UNKNOWNID +
// total, s=1 -> row) are replayed separately in ./cursor-20-1.test.ts
// against the queue-1 cursor transcripts.
//
// Rule: expected names come from the YAML, never from hardcoded labels. The
// mini parser (./m2-replay.ts) is independent of the work/ harness decoder.

import { describe, expect, test } from "bun:test";
import {
	decodeFixtureEntries,
	loadFixture,
	loadYamlDoc,
	required,
	requiredEntry,
	rowsOf,
} from "./m2-replay";

interface StdKeysDoc {
	keys: Record<string, { "canonical-name"?: string; notes?: string }>;
}

describe("ip-address [20,1] bare replay", () => {
	test("schema binds STD_OBJ_COUNT + its [20,1] note", () => {
		const std = loadYamlDoc<StdKeysDoc>("profiles/winbox-ipc/std-keys.yaml");
		const total = required(std.keys[String(0xfe0019)], "keys[0xfe0019]");
		expect(total["canonical-name"]).toBe("STD_OBJ_COUNT");
		expect(required(total.notes, "0xfe0019 notes")).toContain("[20,1]");
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const v6 = loadFixture("6.49-getall-20-1.json");
		const v7 = loadFixture("7.25-getall-20-1.json");
		expect(v6.records.length).toBe(1);
		expect(v7.records.length).toBe(1);
		for (const record of [...v6.records, ...v7.records]) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("bare reply carries one row + total 1, both versions", () => {
		for (const name of ["6.49-getall-20-1.json", "7.25-getall-20-1.json"]) {
			const fixture = loadFixture(name);
			const record = required(fixture.records[0], `${name} reply`);
			const entries = decodeFixtureEntries(record.hex);
			expect(record.from).toEqual([20, 1]);
			const rows = rowsOf(requiredEntry(entries, "0xfe0002", "STD_OBJS"));
			expect(rows.length).toBe(1);
			expect(
				requiredEntry(required(rows[0], `${name} row 0`), "0xfe0001", "row-id")
					.value,
			).toBe(1);
			expect(requiredEntry(entries, "0xfe0019", "STD_OBJ_COUNT").value).toBe(1);
		}
	});
});
