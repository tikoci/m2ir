// NAT action-enum replay: /ip/firewall/nat [20,5] f40 on 7.25.
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (nat-20-5 field 40 values map +
// set:) and profiles/winbox-ipc/std-commands.yaml (CMD_SETOBJ). The wire
// bytes live in fixtures/winbox-ipc/7.25-nat-f40-enum.json, sanitized from
// work/2026-11-winbox-attributes/proof/7.25-nat-action/ and
// work/2026-11-winbox-attributes/proof/7.25-nat-followup/.
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

interface FieldDef {
	name: string;
	tcode: string;
	access?: string;
	values?: Record<string, string>;
}

interface GuiHandlersDoc {
	handlers: Record<
		string,
		{
			"sys-to": number[];
			fields: { "namespace-user": Record<string, FieldDef> };
			set: { cmd: { value: number; name: string }; versions: string[] };
			notes: string;
			evidence: Array<{ ref: string }>;
		}
	>;
}

const FIXTURE = "7.25-nat-f40-enum.json";

const MATRIX_IDS = [
	"matrix-srcnat-accept",
	"matrix-srcnat-passthrough",
	"matrix-srcnat-return",
	"matrix-srcnat-log",
	"matrix-srcnat-add-src",
	"matrix-srcnat-src-nat",
	"matrix-srcnat-masquerade",
	"matrix-srcnat-netmap",
	"matrix-dstnat-accept",
	"matrix-dstnat-dst-nat",
	"matrix-dstnat-add-dst",
] as const;

function natHandler(doc: GuiHandlersDoc) {
	return required(doc.handlers["nat-20-5"], "handlers.nat-20-5");
}

function actionField(doc: GuiHandlersDoc): FieldDef {
	const handler = natHandler(doc);
	return required(handler.fields["namespace-user"]["40"], "nat-20-5 field 40");
}

function firstRowOf(hex: string) {
	const decoded = decodeFixtureEntries(hex);
	const rows = rowsOf(requiredEntry(decoded, "0xfe0002", "rows"));
	return required(rows[0], "single matrix row");
}

describe("nat f40 enum [20,5] replay", () => {
	test("schema carries the promoted 11-value action map", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const handler = natHandler(gui);
		expect(handler["sys-to"]).toEqual([20, 5]);
		const action = actionField(gui);
		expect(action.name).toBe("action");
		expect(action.access).toBe("read-write");
		const values = required(action.values, "f40 values map");
		expect(Object.keys(values)).toHaveLength(11);
		// The full expected map comes from the schema itself; spot-check
		// the wire-critical members the inverse leg depends on.
		expect(values["0"]).toBe("accept");
		expect(values["4"]).toBe("passthrough");
		expect(values["23"]).toBe("redirect");
		expect(handler.set.cmd.value).toBe(0xfe0003);
		expect(handler.set.versions).toContain("7.25");
		// The drop negative is recorded, not silently absent.
		expect(handler.notes).toContain("drop has NO f40");
		expect(handler.notes).toContain(":parse");
	});

	test("promoted evidence references resolve to tracked files", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const refs = natHandler(gui)
			.evidence.map((e) => e.ref)
			.join("\n");
		expect(refs).toContain("proof/7.25-nat-action");
		expect(refs).toContain("proof/7.25-nat-followup");
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/7.25-nat-action/report.yaml",
			"work/2026-11-winbox-attributes/proof/7.25-nat-followup/report.yaml",
			"work/2026-11-winbox-attributes/proof/7.25-nat-followup/step-inv.jsonl",
			"work/2026-11-winbox-attributes/proof/7.25-nat-followup/step-red.jsonl",
			`fixtures/winbox-ipc/${FIXTURE}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture(FIXTURE);
		expect(fixture.provenance.routeros_version).toBe("7.25");
		expect(fixture.records.length).toBe(16);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("every schema value rides a matrix row under its own name", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const values = required(actionField(gui).values, "f40 values map");
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));

		const seen = new Map<number, string>();
		for (const id of MATRIX_IDS) {
			const row = firstRowOf(required(byId.get(id), id).hex);
			const f40 = requiredEntry(row, "0x000028", `${id} f40`);
			expect(f40.tcode).toBe("0x9");
			const comment = String(
				requiredEntry(row, "0xfe0009", `${id} comment`).value,
			);
			seen.set(f40.value as number, comment);
		}
		// Each schema value appears on the wire, in a row whose synthetic
		// comment names the same action — and no value outside the map.
		expect([...seen.keys()].sort((a, b) => a - b)).toEqual(
			Object.keys(values)
				.map(Number)
				.filter((n) => n !== 23)
				.sort((a, b) => a - b),
		);
		for (const [num, name] of Object.entries(values)) {
			if (num === "23") continue; // redirect leg below, not the matrix
			expect(seen.get(Number(num))).toContain(name);
		}
	});

	test("redirect row carries f40=23 with its proto/ports context", () => {
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const row = firstRowOf(
			required(byId.get("redirect-getall"), "redirect-getall").hex,
		);
		expect(requiredEntry(row, "0x000028", "f40").value).toBe(23);
		expect(requiredEntry(row, "0x000027", "chain").value).toBe("dstnat");
		expect(requiredEntry(row, "0x00000b", "proto").value).toBe(6);
		expect(requiredEntry(row, "0x0003ea", "to-ports-start").value).toBe(8080);
		expect(requiredEntry(row, "0x0003eb", "to-ports-end").value).toBe(8080);
	});

	test("inverse SETOBJ moves f40 along the schema map", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const handler = natHandler(gui);
		const values = required(actionField(gui).values, "f40 values map");
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));

		const tx = decodeFixtureEntries(
			required(byId.get("inv-set-tx"), "inv-set-tx").hex,
		);
		expect(required(byId.get("inv-set-tx"), "inv-set-tx").cmd).toBe(
			handler.set.cmd.value,
		);
		expect(requiredEntry(tx, "0xfe0001", "rowid").value).toBe(15);
		expect(requiredEntry(tx, "0x000028", "f40").value).toBe(4);

		const before = firstRowOf(
			required(byId.get("inv-before-getall"), "inv-before-getall").hex,
		);
		const after = firstRowOf(
			required(byId.get("inv-verify-getall"), "inv-verify-getall").hex,
		);
		const fromValue = requiredEntry(before, "0x000028", "before f40").value;
		const toValue = requiredEntry(after, "0x000028", "after f40").value;
		expect(fromValue).toBe(0);
		expect(toValue).toBe(4);
		// Schema-resolved names for the transition endpoints.
		expect(values[String(fromValue)]).toBe("accept");
		expect(values[String(toValue)]).toBe("passthrough");
		// Same row, nothing else moved.
		expect(requiredEntry(after, "0xfe0001", "rowid").value).toBe(15);
	});
});
