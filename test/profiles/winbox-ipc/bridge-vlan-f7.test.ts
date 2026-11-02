// Bridge vlan f7 replay: mvrp-forbidden set + reversal symmetry.
//
// The schema entry under test lives in
// profiles/winbox-ipc/gui-handlers.yaml (bridge-vlan f7). The wire bytes
// live in fixtures/winbox-ipc/7.25-bridge-vlan-f7.json, captured on twin3
// (7.25) by the G2 write leg (8w+0r).
//
// Rule: expected names come from the YAML, never from hardcoded labels. The
// mini parser (./m2-replay.ts) is independent of the work/ harness decoder.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
	decodeFixtureEntries,
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
				"namespace-user"?: Record<string, { name?: string }>;
			};
		}
	>;
}

const FIXTURE = "7.25-bridge-vlan-f7.json";

function cellF7(recordId: string): unknown {
	const fixture = loadFixture(FIXTURE);
	const byId = new Map(fixture.records.map((r) => [r.id, r]));
	const rx = decodeFixtureEntries(required(byId.get(recordId), recordId).hex);
	const rows = rowsOf(requiredEntry(rx, "0xfe0002", `${recordId} rows`));
	expect(rows.length).toBe(1);
	return requiredEntry(required(rows[0], "row"), "0x000007", "f7").value;
}

describe("bridge vlan f7 replay", () => {
	test("schema carries f7 as mvrp-forbidden", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const vlan = required(gui.handlers["bridge-vlan"], "bridge-vlan");
		const user = required(vlan.fields?.["namespace-user"], "user fields");
		expect(user["7"]?.name).toBe("mvrp-forbidden");
		expect(required(vlan.notes, "vlan notes")).toContain("CLOSES U-vlan-f7");
	});

	test("promoted evidence references resolve to tracked files", () => {
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/G2-vlan-f7/report.yaml",
			"work/2026-11-winbox-attributes/proof/G2-vlan-f7/step-cell-B.jsonl",
			"work/2026-11-winbox-attributes/proof/G2-vlan-f7/cell-B-vlan.json",
			`fixtures/winbox-ipc/${FIXTURE}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture(FIXTURE);
		expect(fixture.provenance.routeros_version).toBe("7.25");
		expect(fixture.records.length).toBe(3);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("f7 tracks []->[2]->[] across set and clear", () => {
		expect(cellF7("getall-cell-A-rx")).toEqual([]);
		expect(cellF7("getall-cell-B-rx")).toEqual([2]);
		expect(cellF7("getall-cell-C-rx")).toEqual([]);
	});
});
