// Bridge-host replay: /interface/bridge/host [16,3] on 7.25.
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (bridge-host fields + notes).
// The wire bytes live in fixtures/winbox-ipc/7.25-bridge-host-16-3.json,
// sanitized from work/2026-11-winbox-attributes/proof/E1-W5r/.
//
// Rule: expected names come from the YAML, never from hardcoded labels. The
// mini parser (./m2-replay.ts) is independent of the work/ harness decoder.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type { FixtureEntry } from "./m2-replay";
import {
	decodeFixtureEntries,
	findEntry,
	loadFixture,
	loadYamlDoc,
	repoPath,
	required,
	requiredEntry,
	rowsOf,
} from "./m2-replay";

interface FieldDef {
	name: string;
	tcode: string;
	role?: string;
}

interface GuiHandlersDoc {
	handlers: Record<
		string,
		{
			"sys-to": number[];
			fields: {
				"namespace-user": Record<string, FieldDef>;
				"namespace-session": Record<string, FieldDef>;
			};
			evidence: Array<{ ref: string }>;
		}
	>;
}

const FIXTURE = "7.25-bridge-host-16-3.json";

const HANDLER = "bridge-host";

function hostHandler(doc: GuiHandlersDoc) {
	return required(doc.handlers[HANDLER], `handlers.${HANDLER}`);
}

function getallRows(hex: string): FixtureEntry[][] {
	const decoded = decodeFixtureEntries(hex);
	return rowsOf(requiredEntry(decoded, "0xfe0002", "rows"));
}

function rowById(rows: FixtureEntry[][], id: number): FixtureEntry[] {
	const row = rows.find(
		(r) => requiredEntry(r, "0xfe0001", "rowid").value === id,
	);
	return required(row, `rowid ${id}`);
}

describe("bridge-host [16,3] replay", () => {
	test("schema carries the host-table owner entry", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const handler = hostHandler(gui);
		expect(handler["sys-to"]).toEqual([16, 3]);
		expect(handler.fields["namespace-user"]["2"]?.name).toBe("mac-address");
		expect(handler.fields["namespace-user"]["2"]?.tcode).toBe("bytes");
		expect(handler.fields["namespace-session"]["7"]?.name).toBe("dynamic");
		expect(Object.keys(handler.fields["namespace-user"])).toHaveLength(8);
		expect(Object.keys(handler.fields["namespace-session"])).toHaveLength(4);
	});

	test("promoted evidence references resolve to tracked files", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const refs = hostHandler(gui)
			.evidence.map((e) => e.ref)
			.join("\n");
		expect(refs).toContain("proof/E1-W5r");
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/E1-W5r/report.yaml",
			"work/2026-11-winbox-attributes/proof/E1-W5r/gate-host.json",
			"work/2026-11-winbox-attributes/proof/E1-W5r/mover-16-3.json",
			`fixtures/winbox-ipc/${FIXTURE}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture(FIXTURE);
		expect(fixture.provenance.routeros_version).toBe("7.25");
		expect(fixture.records.length).toBe(6);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("GETCOUNT moves 0->3 on [16,3] with the [16,2] co-move", () => {
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const host = decodeFixtureEntries(
			required(byId.get("host-getcount-rx"), "host count rx").hex,
		);
		expect(requiredEntry(host, "0xfe0019", "host count").value).toBe(3);
		const port = decodeFixtureEntries(
			required(byId.get("port-getcount-rx"), "port count rx").hex,
		);
		expect(requiredEntry(port, "0xfe0019", "port count").value).toBe(1);
	});

	test("host rows carry MACs in f2 with dynamic in session", () => {
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const rows = getallRows(
			required(byId.get("host-getall-rx"), "host rx").hex,
		);
		expect(rows).toHaveLength(3);
		// Static row: the pinned MAC, dynamic=false, 12 keys, no f105.
		const stat = rowById(rows, 6);
		expect(requiredEntry(stat, "0x000002", "mac").value).toBe(
			"hex:020000e10001",
		);
		expect(requiredEntry(stat, "0xfe0007", "dynamic").value).toBe(false);
		expect(stat).toHaveLength(12);
		expect(findEntry(stat, "0x000069")).toBeUndefined();
		// Dynamic rows: distinct MACs, dynamic=true, 13 keys with f105=0.
		for (const id of [8, 7]) {
			const row = rowById(rows, id);
			expect(requiredEntry(row, "0xfe0007", "dynamic").value).toBe(true);
			expect(row).toHaveLength(13);
			expect(requiredEntry(row, "0x000069", "f105").value).toBe(0);
		}
		expect(requiredEntry(rowById(rows, 8), "0x000002", "mac8").value).toBe(
			"hex:0291a66c44d5",
		);
		expect(requiredEntry(rowById(rows, 7), "0x000002", "mac7").value).toBe(
			"hex:52550a000202",
		);
		// f4=3 (live e1br rowid) on all rows.
		for (const row of rows) {
			expect(requiredEntry(row, "0x000004", "f4").value).toBe(3);
		}
	});
});
