// VRF-identity replay: /ip/address [20,1] f6 on 7.25.
//
// The schema entry under test lives in
// profiles/winbox-ipc/gui-handlers.yaml (ip-address field 6 = vrf).
// The wire bytes live in fixtures/winbox-ipc/7.25-vrf-f6-20-1.json,
// sanitized from work/2026-11-winbox-attributes/proof/E2-W/.
//
// Rule: expected names come from the YAML, never from hardcoded labels. The
// mini parser (./m2-replay.ts) is independent of the work/ harness decoder.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type { FixtureEntry } from "./m2-replay";
import {
	decodeFixtureEntries,
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
	"cli-alias"?: string;
}

interface GuiHandlersDoc {
	handlers: Record<
		string,
		{
			"sys-to": number[];
			fields: { "namespace-user": Record<string, FieldDef> };
			evidence: Array<{ ref: string }>;
		}
	>;
}

const FIXTURE = "7.25-vrf-f6-20-1.json";

const HANDLER = "ip-address";

function addrHandler(doc: GuiHandlersDoc) {
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

describe("vrf f6 [20,1] replay", () => {
	test("schema carries the promoted vrf name on f6", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const handler = addrHandler(gui);
		expect(handler["sys-to"]).toEqual([20, 1]);
		expect(handler.fields["namespace-user"]["6"]?.name).toBe("vrf");
		expect(handler.fields["namespace-user"]["6"]?.tcode).toBe("u32");
		expect(handler.fields["namespace-user"]["6"]?.["cli-alias"]).toBe(
			"/ip/address vrf",
		);
	});

	test("promoted evidence references resolve to tracked files", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const refs = addrHandler(gui)
			.evidence.map((e) => e.ref)
			.join("\n");
		expect(refs).toContain("proof/E2-W");
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/E2-W/report.yaml",
			"work/2026-11-winbox-attributes/proof/E2-W/step-legB-add.json",
			"work/2026-11-winbox-attributes/proof/E2-W/native-ws20.jsonl",
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

	test("f6 is 0 without the vrf row and 1 only on it", () => {
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		// Without-address control: VRF exists, no address row carries it.
		const control = getallRows(
			required(byId.get("vrf-add-read-rx"), "vrf-add rx").hex,
		);
		expect(control).toHaveLength(1);
		expect(
			requiredEntry(control[0] as FixtureEntry[], "0x000006", "control f6")
				.value,
		).toBe(0);
		// Stimulus: f6=1 on the vrf row only, main row holds 0.
		const rows = getallRows(
			required(byId.get("vrf-row-read-rx"), "vrf-row rx").hex,
		);
		expect(rows).toHaveLength(2);
		expect(requiredEntry(rowById(rows, 1), "0x000006", "main f6").value).toBe(
			0,
		);
		const vrfRow = rowById(rows, 3);
		const f6 = requiredEntry(vrfRow, "0x000006", "vrf f6");
		expect(f6.tcode).toBe("0x9");
		expect(f6.value).toBe(1);
		// f11 stays false on both surfaces of this leg.
		for (const row of rows) {
			expect(requiredEntry(row, "0x00000b", "f11").value).toBe(false);
		}
	});
});
