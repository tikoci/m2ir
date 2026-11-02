// Address slave-flag replay: f11 tracks bridge enslavement with full symmetry.
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (ip-address f11 + notes). The wire
// bytes live in fixtures/winbox-ipc/7.25-f11-slave-20-1.json: baseline,
// enslaved, and deenslaved GETALL rows captured on ws20 (7.25) by the
// F-f11 write leg (6w+0r).
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
				"namespace-user"?: Record<
					string,
					{ name?: string; role?: string; "cli-alias"?: string }
				>;
			};
		}
	>;
}

const FIXTURE = "7.25-f11-slave-20-1.json";

function getallRows(recordId: string): FixtureEntry[][] {
	const fixture = loadFixture(FIXTURE);
	const byId = new Map(fixture.records.map((r) => [r.id, r]));
	const rx = decodeFixtureEntries(required(byId.get(recordId), recordId).hex);
	return rowsOf(requiredEntry(rx, "0xfe0002", `${recordId} rows`));
}

describe("address slave-flag replay", () => {
	test("schema names f11 as the slave flag", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const addr = required(gui.handlers["ip-address"], "ip-address");
		const user = required(addr.fields?.["namespace-user"], "user fields");
		expect(user["11"]?.name).toBe("slave");
		expect(user["11"]?.["cli-alias"]).toBe("/ip/address slave");
		expect(required(user["11"]?.role, "f11 role")).toContain("PROVEN");
		expect(required(addr.notes, "addr notes")).toContain("F-f11 write leg");
	});

	test("promoted evidence references resolve to tracked files", () => {
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/F-f11/report.yaml",
			"work/2026-11-winbox-attributes/proof/F-f11/step-baseline.jsonl",
			"work/2026-11-winbox-attributes/proof/F-f11/step-enslaved.jsonl",
			"work/2026-11-winbox-attributes/proof/F-f11/step-deenslaved.jsonl",
			"work/2026-11-winbox-attributes/proof/F-f11/control-enslaved-read.json",
			"work/2026-11-winbox-attributes/proof/F-f11/control-deenslaved-read.json",
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

	test("f11 runs false/true/false across enslave/deenslave", () => {
		const base = required(getallRows("getall-baseline-rx")[0], "base row");
		expect(requiredEntry(base, "0x00000b", "f11").value).toBe(false);
		const ens = getallRows("getall-enslaved-rx");
		expect(ens.length).toBe(2);
		expect(
			requiredEntry(required(ens[0], "dhcp row"), "0x00000b", "f11").value,
		).toBe(false);
		const flipped = required(ens[1], "enslaved row");
		expect(requiredEntry(flipped, "0x00000b", "f11").value).toBe(true);
		// vrf stays main on the flipped row: f6 is not the driver.
		expect(requiredEntry(flipped, "0x000006", "f6").value).toBe(0);
		const back = getallRows("getall-deenslaved-rx");
		expect(
			requiredEntry(required(back[1], "restored row"), "0x00000b", "f11").value,
		).toBe(false);
	});
});
