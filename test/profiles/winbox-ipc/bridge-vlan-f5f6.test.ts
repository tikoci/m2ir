// Bridge-vlan current-side replay: f5=current-tagged, f6=current-untagged.
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (bridge-vlan f5/f6 names + notes).
// The wire bytes live in
// fixtures/winbox-ipc/7.25-bridge-vlan-cells.json: the full 2x2
// (filtering x move) GETALL rows captured on twin3 (7.25) by the F-vlan
// write leg (9w+0r).
//
// Rule: expected names come from the YAML, never from hardcoded labels. The
// mini parser (./m2-replay.ts) is independent of the work/ harness decoder.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
	decodeFixtureEntries,
	type FixtureEntry,
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
				"namespace-user"?: Record<string, { name?: string; role?: string }>;
			};
		}
	>;
}

const FIXTURE = "7.25-bridge-vlan-cells.json";

function cellRows(recordId: string): FixtureEntry[][] {
	const fixture = loadFixture(FIXTURE);
	const byId = new Map(fixture.records.map((r) => [r.id, r]));
	const rx = decodeFixtureEntries(required(byId.get(recordId), recordId).hex);
	return rowsOf(requiredEntry(rx, "0xfe0002", `${recordId} rows`));
}

function u32Array(row: FixtureEntry[], key: string): unknown {
	return requiredEntry(row, key, key).value;
}

describe("bridge-vlan current-side replay", () => {
	test("schema names f5/f6 as the current pair", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const vlan = required(gui.handlers["bridge-vlan"], "bridge-vlan");
		const user = required(vlan.fields?.["namespace-user"], "user fields");
		expect(user["5"]?.name).toBe("current-tagged");
		expect(user["6"]?.name).toBe("current-untagged");
		expect(required(user["5"]?.role, "f5 role")).toContain("PROVEN");
		expect(required(user["6"]?.role, "f6 role")).toContain("PROVEN");
		expect(required(vlan.notes, "vlan notes")).toContain("CLOSES u-vlan-f5-f6");
	});

	test("promoted evidence references resolve to tracked files", () => {
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/F-vlan/report.yaml",
			"work/2026-11-winbox-attributes/proof/F-vlan/step-cell-A.jsonl",
			"work/2026-11-winbox-attributes/proof/F-vlan/step-cell-B.jsonl",
			"work/2026-11-winbox-attributes/proof/F-vlan/step-cell-C.jsonl",
			"work/2026-11-winbox-attributes/proof/F-vlan/step-cell-D.jsonl",
			"work/2026-11-winbox-attributes/proof/F-vlan/cell-A-vlan.json",
			"work/2026-11-winbox-attributes/proof/F-vlan/cell-B-vlan.json",
			"work/2026-11-winbox-attributes/proof/F-vlan/cell-C-vlan.json",
			"work/2026-11-winbox-attributes/proof/F-vlan/cell-D-vlan.json",
			`fixtures/winbox-ipc/${FIXTURE}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture(FIXTURE);
		expect(fixture.provenance.routeros_version).toBe("7.25");
		expect(fixture.records.length).toBe(4);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("cells A/B keep f5/f6 empty with currents empty", () => {
		for (const id of ["cell-A-rx", "cell-B-rx"]) {
			const rows = cellRows(id);
			expect(rows.length).toBe(1);
			const row = required(rows[0], `${id} row`);
			expect(u32Array(row, "0x000005")).toEqual([]);
			expect(u32Array(row, "0x000006")).toEqual([]);
		}
		// Cell B inverse f4 proof: configured-untagged emptied by the move.
		const rowB = required(cellRows("cell-B-rx")[0], "cell B row");
		expect(u32Array(rowB, "0x000004")).toEqual([]);
		expect(u32Array(rowB, "0x000003")).toEqual([3, 2]);
		const rowA = required(cellRows("cell-A-rx")[0], "cell A row");
		expect(u32Array(rowA, "0x000004")).toEqual([2]);
	});

	test("cell C assigns f5 on the static row, f6 on the dynamic row", () => {
		const rows = cellRows("cell-C-rx");
		expect(rows.length).toBe(2);
		const static_ = required(rows[0], "cell C static row");
		expect(u32Array(static_, "0x000005")).toEqual([3, 2]);
		expect(u32Array(static_, "0x000006")).toEqual([]);
		const dynamic = required(rows[1], "cell C dynamic row");
		expect(u32Array(dynamic, "0x000001")).toEqual([1, 1]);
		expect(u32Array(dynamic, "0x000005")).toEqual([]);
		expect(u32Array(dynamic, "0x000006")).toEqual([3, 2]);
		expect(requiredEntry(dynamic, "0xfe0007", "dynamic").value).toBe(true);
	});

	test("cell D splits f5/f6 on one row", () => {
		const rows = cellRows("cell-D-rx");
		expect(rows.length).toBe(2);
		const row = required(rows[0], "cell D row");
		expect(u32Array(row, "0x000003")).toEqual([3]);
		expect(u32Array(row, "0x000004")).toEqual([2]);
		expect(u32Array(row, "0x000005")).toEqual([3]);
		expect(u32Array(row, "0x000006")).toEqual([2]);
	});
});
