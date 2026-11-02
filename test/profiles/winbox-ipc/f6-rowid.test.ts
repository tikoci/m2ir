// f6 rowid-vs-flag decision: the containing VRF's .id rides f6 exactly
// (main *0 -> 0, h2vrf1 *1 -> 1, h2vrf2 *2 -> 2) — rowid PROVEN, flag dead.
//
// The schema entry under test lives in
// profiles/winbox-ipc/gui-handlers.yaml (ip-address field 6). The wire
// bytes live in fixtures/winbox-ipc/7.26beta5-f6-rowid.json ([20,1]
// GETALL rx at B0/B4/B5), captured on g4beta5 (7.26beta5) by the H2
// write leg (10w+0r).
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
			fields?: {
				"namespace-user"?: Record<string, { name?: string; role?: string }>;
			};
		}
	>;
}

const FIXTURE = "7.26beta5-f6-rowid.json";
const H2 = "work/2026-11-winbox-attributes/proof/H2-f6";

function getallRows(recordId: string): FixtureEntry[][] {
	const fixture = loadFixture(FIXTURE);
	const byId = new Map(fixture.records.map((r) => [r.id, r]));
	const rx = decodeFixtureEntries(required(byId.get(recordId), recordId).hex);
	return rowsOf(requiredEntry(rx, "0xfe0002", `${recordId} rows`));
}

function fieldOf(
	row: FixtureEntry[],
	key: string,
	what: string,
): FixtureEntry["value"] {
	const hit = row.find((e) => e.key === key);
	return required(hit, what).value;
}

describe("f6 rowid decision replay", () => {
	test("schema carries the H2 rowid-PROVEN f6 role", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const addr = required(gui.handlers["ip-address"], "ip-address");
		const user = required(addr.fields?.["namespace-user"], "user fields");
		const f6 = required(user["6"], "f6");
		expect(f6.name).toBe("vrf");
		expect(required(f6.role, "f6 role")).toContain("ROWID PROVEN");
		expect(required(f6.role, "f6 role")).toContain("flag dead");
	});

	test("promoted evidence references resolve to tracked files", () => {
		for (const rel of [
			`${H2}/report.yaml`,
			`${H2}/fragment.yaml`,
			`${H2}/step-B0.jsonl`,
			`${H2}/step-B4.jsonl`,
			`${H2}/step-B5.jsonl`,
			`${H2}/control-B4-read.json`,
			`${H2}/control-B5-read.json`,
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

	test("f6 tracks the VRF .id 0-1-2 across B0-B4-B5", () => {
		const b0 = getallRows("getall-20-1-h2-b0-rx");
		expect(b0.length).toBe(1);
		expect(fieldOf(required(b0[0], "main row"), "0x000006", "B0 f6")).toBe(0);
		const b4 = getallRows("getall-20-1-h2-b4-rx");
		expect(b4.length).toBe(2);
		const vrf1 = required(
			b4.find((r) => fieldOf(r, "0xfe0009", "comment") === "h2vrf1"),
			"h2vrf1 row",
		);
		expect(vrf1.length).toBe(13);
		expect(fieldOf(vrf1, "0x000006", "B4 f6")).toBe(1);
		const b5 = getallRows("getall-20-1-h2-b5-rx");
		expect(b5.length).toBe(3);
		const vrf2 = required(
			b5.find((r) => fieldOf(r, "0xfe0009", "comment") === "h2vrf2"),
			"h2vrf2 row",
		);
		expect(vrf2.length).toBe(13);
		expect(fieldOf(vrf2, "0x000006", "B5 f6")).toBe(2);
	});
});
