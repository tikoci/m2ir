// Beta-line populated shapes replay: 40-key port row, 12-key vlan cell,
// f6=1 VRF row, f5/f10 split, f11 slave reproduction.
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (bridge-port, bridge-vlan, and
// ip-address beta notes). The wire bytes live in
// fixtures/winbox-ipc/7.26beta5-populated-shapes.json, captured on g4beta5
// (7.26beta5) by the G4 write leg (10w+0r).
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
				"namespace-user"?: Record<string, { name?: string }>;
			};
		}
	>;
}

const FIXTURE = "7.26beta5-populated-shapes.json";

function getallRows(recordId: string): FixtureEntry[][] {
	const fixture = loadFixture(FIXTURE);
	const byId = new Map(fixture.records.map((r) => [r.id, r]));
	const rx = decodeFixtureEntries(required(byId.get(recordId), recordId).hex);
	return rowsOf(requiredEntry(rx, "0xfe0002", `${recordId} rows`));
}

describe("beta5 populated shapes replay", () => {
	test("schema carries the G4 beta-line notes", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const port = required(gui.handlers["bridge-port"], "bridge-port");
		expect(required(port.notes, "port notes")).toContain(
			"G4 write leg (g4beta5 7.26beta5",
		);
		const vlan = required(gui.handlers["bridge-vlan"], "bridge-vlan");
		expect(required(vlan.notes, "vlan notes")).toContain(
			"G4 write leg (g4beta5 7.26beta5",
		);
		const addr = required(gui.handlers["ip-address"], "ip-address");
		expect(required(addr.notes, "addr notes")).toContain(
			"G4 write leg (g4beta5 7.26beta5",
		);
	});

	test("promoted evidence references resolve to tracked files", () => {
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/G4-beta5-populated/report.yaml",
			"work/2026-11-winbox-attributes/proof/G4-beta5-populated/step-B3.jsonl",
			"work/2026-11-winbox-attributes/proof/G4-beta5-populated/step-B5.jsonl",
			"work/2026-11-winbox-attributes/proof/G4-beta5-populated/control-B5-read.json",
			`fixtures/winbox-ipc/${FIXTURE}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture(FIXTURE);
		expect(fixture.provenance.routeros_version).toBe("7.26beta5");
		expect(fixture.records.length).toBe(3);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("port row is 40 keys with live f3/f4 rowids", () => {
		const rows = getallRows("getall-16-2-rx");
		expect(rows.length).toBe(1);
		const row = required(rows[0], "port row");
		expect(row.length).toBe(40);
		expect(requiredEntry(row, "0x000003", "f3").value).toBe(2);
		expect(requiredEntry(row, "0x000004", "f4").value).toBe(4);
	});

	test("vlan cell is 12 keys with the cell-A value shape", () => {
		const rows = getallRows("getall-16-13-rx");
		expect(rows.length).toBe(1);
		const row = required(rows[0], "vlan row");
		expect(row.length).toBe(12);
		expect(requiredEntry(row, "0x000003", "f3").value).toEqual([4]);
		expect(requiredEntry(row, "0x000004", "f4").value).toEqual([2]);
		expect(requiredEntry(row, "0x000007", "f7").value).toEqual([]);
	});

	test("VRF row carries f6=1 while the main row reads f6=0", () => {
		const rows = getallRows("getall-20-1-rx");
		expect(rows.length).toBe(2);
		const main = required(rows[0], "main row");
		const vrf = required(rows[1], "vrf row");
		expect(requiredEntry(main, "0x000006", "main f6").value).toBe(0);
		expect(requiredEntry(vrf, "0x000006", "vrf f6").value).toBe(1);
		expect(requiredEntry(vrf, "0xfe0009", "vrf comment").value).toBe("g4b5");
	});

	test("enslavement splits f5/f10 and flips f11", () => {
		const rows = getallRows("getall-20-1-rx");
		const main = required(rows[0], "main row");
		const vrf = required(rows[1], "vrf row");
		expect(requiredEntry(main, "0x000005", "main f5").value).toBe(4);
		expect(requiredEntry(main, "0x00000a", "main f10").value).toBe(2);
		expect(requiredEntry(main, "0x00000b", "main f11").value).toBe(true);
		expect(requiredEntry(vrf, "0x000005", "vrf f5").value).toBe(3);
		expect(requiredEntry(vrf, "0x00000a", "vrf f10").value).toBe(3);
		expect(requiredEntry(vrf, "0x00000b", "vrf f11").value).toBe(false);
	});
});
