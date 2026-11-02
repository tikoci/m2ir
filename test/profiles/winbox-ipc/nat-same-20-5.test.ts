// NAT same-action replay: /ip/firewall/nat [20,5] f40=24 + adjuncts on 7.25.
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (nat-20-5 action values + f1005 +
// f1006). The wire bytes live in fixtures/winbox-ipc/7.25-nat-same-20-5.json,
// sanitized from work/2026-11-winbox-attributes/proof/E3-W/.
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
	"cli-alias"?: string;
	values?: Record<string, string>;
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

const FIXTURE = "7.25-nat-same-20-5.json";

const HANDLER = "nat-20-5";

function natHandler(doc: GuiHandlersDoc) {
	return required(doc.handlers[HANDLER], `handlers.${HANDLER}`);
}

function singleRow(hex: string): FixtureEntry[] {
	const decoded = decodeFixtureEntries(hex);
	const rows = rowsOf(requiredEntry(decoded, "0xfe0002", "rows"));
	expect(rows).toHaveLength(1);
	return required(rows[0], "single nat row");
}

describe("nat same f40=24 [20,5] replay", () => {
	test("schema carries same=24 plus the f1005/f1006 fields", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const handler = natHandler(gui);
		expect(handler["sys-to"]).toEqual([20, 5]);
		const user = handler.fields["namespace-user"];
		expect(user["40"]?.values?.["24"]).toBe("same");
		expect(user["1005"]?.name).toBe("same-not-by-dst");
		expect(user["1005"]?.tcode).toBe("bool");
		expect(user["1006"]?.name).toBe("unknown-f1006");
		expect(user["1006"]?.tcode).toBe("bool");
	});

	test("promoted evidence references resolve to tracked files", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const refs = natHandler(gui)
			.evidence.map((e) => e.ref)
			.join("\n");
		expect(refs).toContain("proof/E3-W");
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/E3-W/report.yaml",
			"work/2026-11-winbox-attributes/proof/E3-W/step-same-v1b.jsonl",
			"work/2026-11-winbox-attributes/proof/E3-W/step-same-v4.jsonl",
			`fixtures/winbox-ipc/${FIXTURE}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture(FIXTURE);
		expect(fixture.provenance.routeros_version).toBe("7.25");
		expect(fixture.records.length).toBe(8);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("all four same rows carry f40=24", () => {
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		for (const id of [
			"same-base-rx",
			"same-not-by-dst-rx",
			"same-to-ports-rx",
			"same-range-rx",
		]) {
			const row = singleRow(required(byId.get(id), id).hex);
			const f40 = requiredEntry(row, "0x000028", `${id} f40`);
			expect(f40.tcode).toBe("0x9");
			expect(f40.value).toBe(24);
		}
	});

	test("same-not-by-dst is the single V1b->V2 delta", () => {
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const base = singleRow(required(byId.get("same-base-rx"), "base").hex);
		const v2 = singleRow(required(byId.get("same-not-by-dst-rx"), "v2").hex);
		expect(findEntry(base, "0x0003ed")).toBeUndefined();
		expect(requiredEntry(v2, "0x0003ed", "f1005").value).toBe(true);
		// f40 unmoved by the adjunct on both rows.
		expect(requiredEntry(base, "0x000028", "base f40").value).toBe(24);
		expect(requiredEntry(v2, "0x000028", "v2 f40").value).toBe(24);
	});

	test("range row splits f1000/f1001, to-ports row carries the cluster", () => {
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const range = singleRow(required(byId.get("same-range-rx"), "range").hex);
		// 192.0.2.1 / 192.0.2.10 as octet-ordered u32.
		expect(requiredEntry(range, "0x0003e8", "start").value).toBe(16908480);
		expect(requiredEntry(range, "0x0003e9", "end").value).toBe(167903424);
		const ports = singleRow(
			required(byId.get("same-to-ports-rx"), "to-ports").hex,
		);
		expect(requiredEntry(ports, "0x0003ea", "ports-start").value).toBe(8080);
		expect(requiredEntry(ports, "0x0003eb", "pend").value).toBe(8080);
		expect(requiredEntry(ports, "0x000016", "f22").value).toBe(false);
		expect(requiredEntry(ports, "0x000194", "f404").value).toBe(true);
		expect(requiredEntry(ports, "0x0003ef", "f1007").value).toBe(true);
	});
});
