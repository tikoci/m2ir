// IPv6 shape-drift replay: /ipv6 address [20,37] on 7.25 + 7.26beta4.
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (ipv6-address unknown-10/11).
// The wire bytes live in fixtures/winbox-ipc/{7.25,7.26beta4}-ipv6-20-37.json,
// sanitized from work/2026-11-winbox-attributes/proof/E2-R-census/.
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
			fields: { "namespace-user": Record<string, FieldDef> };
			evidence: Array<{ ref: string }>;
		}
	>;
}

const FIXTURE_V7 = "7.25-ipv6-20-37.json";
const FIXTURE_BETA4 = "7.26beta4-ipv6-20-37.json";

const HANDLER = "ipv6-address";

function ipv6Handler(doc: GuiHandlersDoc) {
	return required(doc.handlers[HANDLER], `handlers.${HANDLER}`);
}

function getallRows(hex: string): FixtureEntry[][] {
	const decoded = decodeFixtureEntries(hex);
	return rowsOf(requiredEntry(decoded, "0xfe0002", "rows"));
}

function userKeys(row: FixtureEntry[]): string[] {
	return row
		.filter((e) => e.key.startsWith("0x00"))
		.map((e) => e.key)
		.sort();
}

describe("ipv6 [20,37] beta4 f10/f11 replay", () => {
	test("schema carries the beta4-only unknown-10/11 entries", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const handler = ipv6Handler(gui);
		expect(handler["sys-to"]).toEqual([20, 37]);
		const user = handler.fields["namespace-user"];
		expect(user["10"]?.name).toBe("unknown-10");
		expect(user["10"]?.tcode).toBe("u32");
		expect(user["11"]?.name).toBe("unknown-11");
		expect(user["11"]?.tcode).toBe("u32");
	});

	test("promoted evidence references resolve to tracked files", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const refs = ipv6Handler(gui)
			.evidence.map((e) => e.ref)
			.join("\n");
		expect(refs).toContain("proof/E2-R-census");
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/E2-R-census/report.yaml",
			"work/2026-11-winbox-attributes/proof/E2-R-census/shape-ws20.json",
			"work/2026-11-winbox-attributes/proof/E2-R-census/shape-winbox-beta4.json",
			`fixtures/winbox-ipc/${FIXTURE_V7}`,
			`fixtures/winbox-ipc/${FIXTURE_BETA4}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		for (const [name, version] of [
			[FIXTURE_V7, "7.25"],
			[FIXTURE_BETA4, "7.26beta4"],
		] as const) {
			const fixture = loadFixture(name);
			expect(fixture.provenance.routeros_version).toBe(version);
			expect(fixture.records.length).toBe(4);
			for (const record of fixture.records) {
				expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
			}
		}
	});

	test("beta4 rows add f10/f11 zeros, 7.25 rows lack them, GETOBJ matches", () => {
		const v7 = loadFixture(FIXTURE_V7);
		const beta4 = loadFixture(FIXTURE_BETA4);
		const byId7 = new Map(v7.records.map((r) => [r.id, r]));
		const byId4 = new Map(beta4.records.map((r) => [r.id, r]));

		const rows7 = getallRows(
			required(byId7.get("ipv6-getall-bare-rx"), "7.25 getall rx").hex,
		);
		const rows4 = getallRows(
			required(byId4.get("ipv6-getall-bare-rx"), "beta4 getall rx").hex,
		);
		expect(rows7.length).toBe(3);
		expect(rows4.length).toBe(2);
		for (const row of rows7) {
			expect(userKeys(row)).not.toContain("0x00000a");
			expect(userKeys(row)).not.toContain("0x00000b");
		}
		for (const row of rows4) {
			const f10 = requiredEntry(row, "0x00000a", "beta4 f10");
			const f11 = requiredEntry(row, "0x00000b", "beta4 f11");
			expect(f10.tcode).toBe("0x9");
			expect(f10.value).toBe(0);
			expect(f11.tcode).toBe("0x9");
			expect(f11.value).toBe(0);
		}

		// GETOBJ flat rows carry the same per-version field set (no wrapper).
		const obj7 = decodeFixtureEntries(
			required(byId7.get("ipv6-getobj-1-rx"), "7.25 getobj rx").hex,
		);
		const obj4 = decodeFixtureEntries(
			required(byId4.get("ipv6-getobj-1-rx"), "beta4 getobj rx").hex,
		);
		expect(findEntry(obj7, "0xfe0002")).toBeUndefined();
		expect(findEntry(obj7, "0x00000a")).toBeUndefined();
		expect(findEntry(obj4, "0x00000a")).toMatchObject({
			tcode: "0x9",
			value: 0,
		});
		expect(findEntry(obj4, "0x00000b")).toMatchObject({
			tcode: "0x9",
			value: 0,
		});
	});
});
