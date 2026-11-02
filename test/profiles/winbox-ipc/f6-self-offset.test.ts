// f6 self-offset finer point CLOSED: a second main-VRF row (*2) reads
// f6=0 in the same GETALL as the DHCP row — address-own-rowid-minus-1
// (which predicted 1) is DISPROVEN; VRF-key survives.
//
// The schema entry under test lives in
// profiles/winbox-ipc/gui-handlers.yaml (ip-address field 6). The wire
// bytes live in fixtures/winbox-ipc/7.26beta5-f6-self-offset.json ([20,1]
// GETALL rx at W1), captured on g4beta5 (7.26beta5) by the I1-B
// main-VRF decider leg (2w+0r).
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

const FIXTURE = "7.26beta5-f6-self-offset.json";
const I1 = "work/2026-11-winbox-attributes/proof/i1-h2-self-offset";

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

describe("f6 self-offset decision replay", () => {
	test("schema carries the I1-B self-offset-CLOSED f6 role", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const addr = required(gui.handlers["ip-address"], "ip-address");
		const user = required(addr.fields?.["namespace-user"], "user fields");
		const f6 = required(user["6"], "f6");
		expect(f6.name).toBe("vrf");
		expect(required(f6.role, "f6 role")).toContain("Finer point CLOSED");
		expect(required(f6.role, "f6 role")).toContain("address-own-rowid-minus-1");
	});

	test("promoted evidence references resolve to tracked files", () => {
		for (const rel of [
			`${I1}/report-b.yaml`,
			`${I1}/leg-sheet-main-b.md`,
			`${I1}/step-W1b.jsonl`,
			`${I1}/control-W1b-read.json`,
			`${I1}/control-W1b-add.json`,
			`fixtures/winbox-ipc/${FIXTURE}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture(FIXTURE);
		expect(fixture.provenance.routeros_version).toBe("7.26beta5");
		expect(fixture.records.length).toBe(1);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("both main rows read f6=0, killing own-rowid-minus-1", () => {
		const rows = getallRows("getall-20-1-i1b-w1-rx");
		expect(rows.length).toBe(2);
		const dhcp = required(
			rows.find((r) => fieldOf(r, "0xfe0001", "rowid") === 1),
			"dhcp row",
		);
		const added = required(
			rows.find((r) => fieldOf(r, "0xfe0009", "comment") === "i1mainb"),
			"i1mainb row",
		);
		expect(dhcp.length).toBe(13);
		expect(added.length).toBe(13);
		expect(fieldOf(added, "0xfe0001", "added rowid")).toBe(2);
		// Self-offset predicted M-1 = 1 for row *2; VRF-key predicted 0.
		expect(fieldOf(dhcp, "0x000006", "dhcp f6")).toBe(0);
		expect(fieldOf(added, "0x000006", "added f6")).toBe(0);
	});
});
