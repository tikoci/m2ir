// Bridge-vlan f4 replay: /interface/bridge/vlan [16,13] on 7.25.
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (bridge-vlan fields f1..f7). The
// wire bytes live in fixtures/winbox-ipc/7.25-bridge-vlan-f4.json,
// sanitized from work/2026-11-winbox-attributes/proof/7.25-e1-bridges/
// (REST currents live in control-w2.json — fixtures carry M2 only).
//
// Rule: expected names come from the YAML, never from hardcoded labels. The
// mini parser (./m2-replay.ts) is independent of the work/ harness decoder.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
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

const FIXTURE = "7.25-bridge-vlan-f4.json";

function vlanHandler(doc: GuiHandlersDoc) {
	return required(doc.handlers["bridge-vlan"], "handlers.bridge-vlan");
}

function firstRowOf(hex: string) {
	const decoded = decodeFixtureEntries(hex);
	const rows = rowsOf(requiredEntry(decoded, "0xfe0002", "rows"));
	return required(rows[0], "single vlan row");
}

describe("bridge-vlan f4 [16,13] replay", () => {
	test("schema carries the promoted f4 name and f7 presence", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const handler = vlanHandler(gui);
		expect(handler["sys-to"]).toEqual([16, 13]);
		const user = handler.fields["namespace-user"];
		expect(user["4"]?.name).toBe("configured-untagged");
		expect(user["7"]?.name).toBe("unknown-7");
		expect(user["7"]?.tcode).toBe("u32_array");
	});

	test("promoted evidence references resolve to tracked files", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const refs = vlanHandler(gui)
			.evidence.map((e) => e.ref)
			.join("\n");
		expect(refs).toContain("proof/7.25-e1-bridges");
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/7.25-e1-bridges/report.yaml",
			"work/2026-11-winbox-attributes/proof/7.25-e1-bridges/control-w2.json",
			`fixtures/winbox-ipc/${FIXTURE}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture(FIXTURE);
		expect(fixture.provenance.routeros_version).toBe("7.25");
		expect(fixture.records.length).toBe(2);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("W2 cell carries f4=[2] with f5/f6/f7 empty and rowid 1", () => {
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const row = firstRowOf(
			required(byId.get("w2-cell-getall"), "w2-cell-getall").hex,
		);
		expect(requiredEntry(row, "0x000004", "f4").value).toEqual([2]);
		expect(requiredEntry(row, "0x000003", "f3").value).toEqual([5]);
		expect(requiredEntry(row, "0x000005", "f5").value).toEqual([]);
		expect(requiredEntry(row, "0x000006", "f6").value).toEqual([]);
		expect(requiredEntry(row, "0x000007", "f7").value).toEqual([]);
		expect(requiredEntry(row, "0x000007", "f7").tcode).toBe("0x88");
		expect(requiredEntry(row, "0x000001", "f1").value).toEqual([10, 10]);
		expect(requiredEntry(row, "0xfe0001", "rowid").value).toBe(1);
	});

	test("REST currents are empty in the same cell (proof control)", () => {
		const control = JSON.parse(
			readFileSync(
				repoPath(
					"work/2026-11-winbox-attributes/proof/7.25-e1-bridges/control-w2.json",
				),
				"utf8",
			),
		) as {
			steps: Array<{
				control?: { route?: string };
				result?: Array<{
					"current-tagged"?: string;
					"current-untagged"?: string;
					untagged?: string;
					"mvrp-forbidden"?: string;
				}>;
			}>;
		};
		const vlan = control.steps.find(
			(s) => s.control?.route === "/interface/bridge/vlan",
		);
		const row = required(
			required(required(vlan, "vlan step").result, "vlan rows")[0],
			"vlan row",
		);
		// f4 is non-empty while both currents are verifiably empty, so f4
		// must be configured-side — the airtight single-cell logic.
		expect(row["current-tagged"]).toBe("");
		expect(row["current-untagged"]).toBe("");
		expect(row.untagged).toBe("ether1");
		expect(row["mvrp-forbidden"]).toBe("");
	});

	test("W2 re-run swap rejection is recorded with its control envelope", () => {
		interface NotesDoc {
			handlers: Record<string, { notes?: string }>;
		}
		const gui = loadYamlDoc<NotesDoc>("profiles/winbox-ipc/gui-handlers.yaml");
		const notes = required(
			gui.handlers["bridge-vlan"],
			"handlers.bridge-vlan",
		).notes;
		expect(notes).toContain("bare-`untagged=` swap");
		expect(notes).toContain("cells B-D lost again");
		const rel = "work/2026-11-winbox-attributes/proof/E1-W2r/control-W2r4.json";
		expect(existsSync(repoPath(rel))).toBe(true);
		const control = JSON.parse(readFileSync(repoPath(rel), "utf8")) as {
			error: { cause: string };
		};
		expect(control.error.cause).toContain(
			"interface cannot be in tagged and untagged at the same time",
		);
	});
});
