// Beta4 E1-leg repeat: [16,2]/[16,13]/[20,1] shapes reproduce 7.25, zero drift.
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (bridge-port, bridge-vlan,
// ip-address Beta4 version-confirmation notes). The wire bytes live in
// fixtures/winbox-ipc/7.26beta4-{bridge-port-16-2,bridge-vlan-16-13,
// getall-getobj-20-1}.json, captured read-only on winbox-beta4
// (7.26beta4 build 2026-10-27) via
// work/2026-11-winbox-attributes/proof/F1-hex-verify/ and cross-checked
// against the F1 decoded-entries captures. 7.25 baselines are the
// committed 7.25 fixtures.
//
// Rule: expected names come from the YAML, never from hardcoded labels. The
// mini parser (./m2-replay.ts) is independent of the work/ harness decoder.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
	decodeFixtureEntries,
	type FixtureEntry,
	findEntry,
	loadFixture,
	loadYamlDoc,
	repoPath,
	required,
	requiredEntry,
} from "./m2-replay";

interface GuiHandlersDoc {
	handlers: Record<string, { notes?: string }>;
}

const FIX_PORT = "7.26beta4-bridge-port-16-2.json";
const FIX_VLAN = "7.26beta4-bridge-vlan-16-13.json";
const FIX_IP = "7.26beta4-getall-getobj-20-1.json";

// Request-driven reqid echo + version banner are expected cross-run deltas.
function normalized(entries: FixtureEntry[]): FixtureEntry[] {
	return entries.map((e) => {
		if (e.key === "0xff0006") return { ...e, value: "<reqid>" };
		if (e.key === "0xff001c") return { ...e, value: ["<proxy>"] };
		return e;
	});
}

describe("beta4 E1-leg repeat", () => {
	test("schema carries the three beta4 confirmations", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		for (const name of ["bridge-port", "bridge-vlan", "ip-address"]) {
			expect(required(gui.handlers[name]?.notes, `${name} notes`)).toContain(
				"Beta4 version-confirmation",
			);
		}
		expect(
			required(gui.handlers["bridge-port"]?.notes, "port notes"),
		).toContain("NOT confirmed on beta4");
		expect(required(gui.handlers["ip-address"]?.notes, "ip notes")).toContain(
			"no beta4 claim on nonzero f6",
		);
	});

	test("promoted evidence references resolve to tracked files", () => {
		for (const rel of [
			`fixtures/winbox-ipc/${FIX_PORT}`,
			`fixtures/winbox-ipc/${FIX_VLAN}`,
			`fixtures/winbox-ipc/${FIX_IP}`,
			"work/2026-11-winbox-attributes/proof/F1-hex-verify/step-hex-verify.jsonl",
			"work/2026-11-winbox-attributes/proof/F1-hex-verify/summary-hex-verify.json",
			"work/2026-11-winbox-attributes/proof/F1-beta4-repeat/report.yaml",
			"work/2026-11-winbox-attributes/proof/F-reviewer/report.yaml",
			"fixtures/winbox-ipc/7.25-getall-20-1.json",
			"fixtures/winbox-ipc/7.25-getobj-20-1.json",
			"fixtures/winbox-ipc/7.25-bridge-vlan-f4.json",
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		for (const [name, count] of [
			[FIX_PORT, 4],
			[FIX_VLAN, 4],
			[FIX_IP, 6],
		] as const) {
			const fixture = loadFixture(name);
			expect(fixture.provenance.routeros_version).toBe("7.26beta4");
			expect(fixture.records.length).toBe(count);
			for (const record of fixture.records) {
				expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
			}
		}
	});

	test("[16,2] beta4 empty GETALL + UNKNOWNID match 7.25 shapes", () => {
		const fixture = loadFixture(FIX_PORT);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const rx = decodeFixtureEntries(
			required(byId.get("getall-16-2-rx"), "getall rx").hex,
		);
		expect(rx.map((e) => `${e.key}/${e.tcode}`)).toEqual([
			"0xff0001/0x88",
			"0xff0002/0x88",
			"0xff001c/0xa0",
			"0xfe0002/0xa8",
			"0xff0003/0x9",
			"0xfe0019/0x9",
			"0xff0006/0x9",
		]);
		expect(requiredEntry(rx, "0xfe0002", "rows").value).toEqual([]);
		expect(requiredEntry(rx, "0xfe0019", "count").value).toBe(0);
		const miss = decodeFixtureEntries(
			required(byId.get("getobj-16-2-999-rx"), "getobj rx").hex,
		);
		expect(requiredEntry(miss, "0xff0008", "errno").value).toBe(16646148);
		expect(requiredEntry(miss, "0xff0004", "status").value).toBe(2);
		expect(findEntry(miss, "0xfe0019")).toBeUndefined();
	});

	test("[16,13] beta4 empty GETALL reproduces w2-proof-empty", () => {
		const fixture = loadFixture(FIX_VLAN);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const rx = decodeFixtureEntries(
			required(byId.get("getall-16-13-rx"), "getall rx").hex,
		);
		const base725 = loadFixture("7.25-bridge-vlan-f4.json");
		const baseById = new Map(base725.records.map((r) => [r.id, r]));
		const base = decodeFixtureEntries(
			required(baseById.get("w2-proof-empty"), "w2-proof-empty").hex,
		);
		expect(normalized(rx)).toEqual(normalized(base));
		const miss = decodeFixtureEntries(
			required(byId.get("getobj-16-13-999-rx"), "getobj rx").hex,
		);
		expect(requiredEntry(miss, "0xff0008", "errno").value).toBe(16646148);
	});

	test("[20,1] beta4 GETALL/GETOBJ reproduce 7.25 exactly", () => {
		const fixture = loadFixture(FIX_IP);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const getall725 = loadFixture("7.25-getall-20-1.json");
		const getallById = new Map(getall725.records.map((r) => [r.id, r]));
		const beta4Row = decodeFixtureEntries(
			required(byId.get("getall-20-1-rx"), "beta4 getall rx").hex,
		);
		const baseRow = decodeFixtureEntries(
			required(getallById.get("bare-getall-reply"), "7.25 bare rx").hex,
		);
		expect(normalized(beta4Row)).toEqual(normalized(baseRow));
		// f6=vrf default zero on the main row, both versions.
		const row725 = requiredEntry(baseRow, "0xfe0002", "7.25 rows")
			.value as Array<Array<FixtureEntry>>;
		expect(row725[0]?.find((e) => e.key === "0x000006")?.value).toBe(0);

		const getobj725 = loadFixture("7.25-getobj-20-1.json");
		const getobjById = new Map(getobj725.records.map((r) => [r.id, r]));
		const beta4Obj = decodeFixtureEntries(
			required(byId.get("getobj-20-1-1-rx"), "beta4 obj1 rx").hex,
		);
		const baseObj = decodeFixtureEntries(
			required(getobjById.get("getobj-20-1-obj=1-reply"), "7.25 obj1 rx").hex,
		);
		expect(normalized(beta4Obj)).toEqual(normalized(baseObj));
		const beta4Miss = decodeFixtureEntries(
			required(byId.get("getobj-20-1-999-rx"), "beta4 obj999 rx").hex,
		);
		const baseMiss = decodeFixtureEntries(
			required(getobjById.get("getobj-20-1-obj=999-reply"), "7.25 obj999 rx")
				.hex,
		);
		expect(normalized(beta4Miss)).toEqual(normalized(baseMiss));
	});
});
