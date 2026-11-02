// Filter f40 action-matrix replay: 9 mapped values, f91 address-list,
// lifecycle notes. The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (filter-20-3 f40/f41/f91,
// unknown-20-32 bycatch notes). The wire bytes live in
// fixtures/winbox-ipc/7.25-filter-f40-matrix.json, captured on ws21
// (7.25) by the G1 write leg (25w+0r).
//
// Rule: expected names come from the YAML, never from hardcoded labels. The
// mini parser (./m2-replay.ts) is independent of the work/ harness decoder.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
	decodeFixtureEntries,
	type FixtureEntry,
	findEntry,
	loadFixture,
	loadYamlDoc,
	repoPath,
	required,
	requiredEntry,
	rowsOf,
} from "./m2-replay";

interface GuiHandlersDoc {
	handlers: Record<
		string,
		{
			notes?: string;
			fields?: {
				"namespace-user"?: Record<
					string,
					{ name?: string; values?: Record<string, string> }
				>;
			};
		}
	>;
}

const FIXTURE = "7.25-filter-f40-matrix.json";

const CELLS: Array<[string, number]> = [
	["m1", 10],
	["m2", 11],
	["m3", 4],
	["m4", 2],
	["m5", 3],
	["m6", 5],
	["m7", 6],
	["m8", 12],
	["m9", 40],
];

function cellRow(recordId: string): FixtureEntry[] {
	const fixture = loadFixture(FIXTURE);
	const byId = new Map(fixture.records.map((r) => [r.id, r]));
	const rx = decodeFixtureEntries(required(byId.get(recordId), recordId).hex);
	const rows = rowsOf(requiredEntry(rx, "0xfe0002", `${recordId} rows`));
	const cell = rows.find((row) =>
		String(findEntry(row, "0xfe0009")?.value ?? "").startsWith("g1-m-"),
	);
	return required(cell, `${recordId} cell row`);
}

describe("filter f40 matrix replay", () => {
	test("schema carries the 11-value f40 enum and f91", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const filter = required(gui.handlers["filter-20-3"], "filter-20-3");
		const user = required(filter.fields?.["namespace-user"], "user fields");
		expect(user["40"]?.name).toBe("action");
		expect(user["40"]?.values).toEqual({
			0: "accept",
			1: "jump",
			2: "return",
			3: "log",
			4: "passthrough",
			5: "add-src-to-address-list",
			6: "add-dst-to-address-list",
			10: "drop",
			11: "reject",
			12: "tarpit",
			40: "fasttrack-connection",
		});
		expect(user["91"]?.name).toBe("address-list");
		expect(required(filter.notes, "filter notes")).toContain("G1 write leg");
		const holder = required(gui.handlers["unknown-20-32"], "unknown-20-32");
		expect(required(holder.notes, "holder notes")).toContain("G1 bycatch");
	});

	test("promoted evidence references resolve to tracked files", () => {
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/G1-f40-matrix/report.yaml",
			"work/2026-11-winbox-attributes/proof/G1-f40-matrix/step-M1.jsonl",
			"work/2026-11-winbox-attributes/proof/G1-f40-matrix/step-M9.jsonl",
			"work/2026-11-winbox-attributes/proof/G1-f40-matrix/step-R1.jsonl",
			"work/2026-11-winbox-attributes/proof/G1-f40-matrix/control-M1-read.json",
			`fixtures/winbox-ipc/${FIXTURE}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture(FIXTURE);
		expect(fixture.provenance.routeros_version).toBe("7.25");
		expect(fixture.records.length).toBe(9);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("each matrix cell row carries its mapped f40", () => {
		for (const [cell, f40] of CELLS) {
			const row = cellRow(`getall-${cell}-rx`);
			expect(requiredEntry(row, "0x000028", `${cell} f40`).value).toBe(f40);
		}
	});

	test("add-src and add-dst share f91 with the list name", () => {
		for (const cell of ["m6", "m7"]) {
			const row = cellRow(`getall-${cell}-rx`);
			expect(requiredEntry(row, "0x00005b", `${cell} f91`).value).toBe(
				"g1-probe",
			);
		}
	});
});
