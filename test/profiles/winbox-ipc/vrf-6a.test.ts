// VRF-alias replay: /interface [20,0] 0x01006a on 7.25.
//
// The schema entry under test lives in
// profiles/winbox-ipc/gui-handlers.yaml (interface namespace-1 field 106).
// The wire bytes live in fixtures/winbox-ipc/7.25-vrf-6a.json, sanitized
// from work/2026-11-winbox-attributes/proof/7.25-e1-bridges/.
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
}

interface GuiHandlersDoc {
	handlers: Record<
		string,
		{
			"sys-to": number[];
			fields: { "namespace-1": Record<string, FieldDef> };
			evidence: Array<{ ref: string }>;
		}
	>;
}

const FIXTURE = "7.25-vrf-6a.json";

const HANDLER = "interface";

function ifaceHandler(doc: GuiHandlersDoc) {
	return required(doc.handlers[HANDLER], `handlers.${HANDLER}`);
}

function rowsOfHex(hex: string): FixtureEntry[][] {
	const decoded = decodeFixtureEntries(hex);
	return rowsOf(requiredEntry(decoded, "0xfe0002", "rows"));
}

function rowByName(rows: FixtureEntry[][], name: string): FixtureEntry[] {
	const row = rows.find(
		(r) => requiredEntry(r, "0x010006", "name").value === name,
	);
	return required(row, `${name} row`);
}

describe("vrf alias 0x01006a [20,0] replay", () => {
	test("schema carries the promoted vrf name", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const handler = ifaceHandler(gui);
		expect(handler["sys-to"]).toEqual([20, 0]);
		expect(handler.fields["namespace-1"]["106"]?.name).toBe("vrf");
		expect(handler.fields["namespace-1"]["106"]?.tcode).toBe("string");
	});

	test("promoted evidence references resolve to tracked files", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const refs = ifaceHandler(gui)
			.evidence.map((e) => e.ref)
			.join("\n");
		expect(refs).toContain("proof/7.25-e1-bridges");
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/7.25-e1-bridges/report.yaml",
			"work/2026-11-winbox-attributes/proof/7.25-e1-bridges/control-w7.json",
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

	test("e1br2 moves main->e1vrf while control ether1 holds main", () => {
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const pre = rowsOfHex(required(byId.get("w7-pre-vrf"), "w7-pre-vrf").hex);
		const post = rowsOfHex(
			required(byId.get("w7-post-vrf"), "w7-post-vrf").hex,
		);
		expect(pre).toHaveLength(3);
		expect(post).toHaveLength(4);

		expect(
			requiredEntry(rowByName(pre, "e1br2"), "0x01006a", "pre 6a").value,
		).toBe("main");
		expect(
			requiredEntry(rowByName(post, "e1br2"), "0x01006a", "post 6a").value,
		).toBe("e1vrf");
		// Control row + rowids stable; the vrf-interface row is new at id 9.
		expect(
			requiredEntry(rowByName(post, "ether1"), "0x01006a", "control 6a").value,
		).toBe("main");
		expect(
			requiredEntry(rowByName(post, "e1br2"), "0xfe0001", "e1br2 rowid").value,
		).toBe(8);
		const vrfRow = rowByName(post, "e1vrf");
		expect(requiredEntry(vrfRow, "0xfe0001", "vrf rowid").value).toBe(9);
		expect(requiredEntry(vrfRow, "0x01001e", "vrf f30").value).toBe("vrf");
		expect(requiredEntry(vrfRow, "0x01006a", "vrf 6a").value).toBe("main");
	});
});
