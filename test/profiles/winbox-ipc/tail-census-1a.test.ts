// Tail census 1a replay: defconf [24,8] gating + version identity,
// QoS [20,114]/[20,115] gating + v6-absent, and the two newly
// catalogued QoS-octet lists [20,120] (2 rows) and [20,121] (8 rows).
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml. The wire bytes live in
// fixtures/winbox-ipc/7.26beta4-qos-120-121.json ([20,120]/[20,121]
// GETALL rx on 7.26beta4; 7.25 rows are identical per the step files).
// All captures are read-only (0w) via the I4 census script.
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
			"sys-to": number[];
			notes?: string;
			fields?: {
				"row-id"?: { namespace: string; field: number };
				"namespace-user"?: Record<string, { name?: string; role?: string }>;
			};
		}
	>;
}

const FIXTURE = "7.26beta4-qos-120-121.json";
const I4 = "work/2026-11-winbox-attributes/proof/i4-tail-census-exec";

function getallRows(recordId: string): FixtureEntry[][] {
	const fixture = loadFixture(FIXTURE);
	const byId = new Map(fixture.records.map((r) => [r.id, r]));
	const rx = decodeFixtureEntries(required(byId.get(recordId), recordId).hex);
	return rowsOf(requiredEntry(rx, "0xfe0002", `${recordId} rows`));
}

function fieldOf(
	row: FixtureEntry[],
	key: string,
): FixtureEntry["value"] | undefined {
	return row.find((e) => e.key === key)?.value;
}

describe("tail census 1a replay", () => {
	test("schema carries the new 120/121 row-list entries", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const h120 = required(gui.handlers["unknown-20-120"], "unknown-20-120");
		expect(h120["sys-to"]).toEqual([20, 120]);
		const f120 = required(
			h120.fields?.["namespace-user"],
			"120 namespace-user",
		);
		expect(required(f120["30"], "120 f30").name).toBe("unknown-30");
		const h121 = required(gui.handlers["unknown-20-121"], "unknown-20-121");
		expect(h121["sys-to"]).toEqual([20, 121]);
		const f121 = required(
			h121.fields?.["namespace-user"],
			"121 namespace-user",
		);
		expect(Object.keys(f121).length).toBe(10);
		expect(required(f121["7"], "121 f7").name).toBe("unknown-7");
	});

	test("schema carries the defconf/QoS gating notes", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const defconf = required(gui.handlers["default-config"], "default-config");
		expect(required(defconf.notes, "defconf notes")).toContain("0xfe0003");
		expect(required(defconf.notes, "defconf notes")).toContain(
			"version-diff leg is exhausted",
		);
		for (const key of ["qos-profile-20-114", "qos-map-20-115"]) {
			const h = required(gui.handlers[key], key);
			expect(required(h.notes, `${key} notes`)).toContain("0xfe0004");
			expect(required(h.notes, `${key} notes`)).toContain("v7-only");
		}
	});

	test("promoted evidence references resolve to tracked files", () => {
		for (const rel of [
			`${I4}/census.ts`,
			`${I4}/report.yaml`,
			`${I4}/step-beta4-defconf.jsonl`,
			`${I4}/step-beta4-qos.jsonl`,
			`${I4}/step-beta4-qos-siblings.jsonl`,
			`${I4}/step-beta4-qos-siblings2.jsonl`,
			`${I4}/step-725-gating.jsonl`,
			`${I4}/step-725-siblings.jsonl`,
			`${I4}/step-725-siblings2.jsonl`,
			`${I4}/step-649-defconf.jsonl`,
			`${I4}/step-649-qos.jsonl`,
			`fixtures/winbox-ipc/${FIXTURE}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture(FIXTURE);
		expect(fixture.provenance.routeros_version).toBe("7.26beta4");
		expect(fixture.records.length).toBe(2);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("[20,120] carries the default/offline pair", () => {
		const rows = getallRows("getall-20-120-qos-census-rx");
		expect(rows.length).toBe(2);
		const names = rows.map((r) => fieldOf(r, "0xfe0010"));
		expect(names).toEqual(["default", "offline"]);
		for (const row of rows) {
			expect(fieldOf(row, "0x00001e")).toBe(255);
		}
		expect(fieldOf(required(rows[1], "offline row"), "0xfe0009")).toBe(
			"Use this for permanently disconnected ports",
		);
	});

	test("[20,121] carries 8 structured rows", () => {
		const rows = getallRows("getall-20-121-qos-census-rx");
		expect(rows.length).toBe(8);
		rows.forEach((row, i) => {
			expect(fieldOf(row, "0xfe0001")).toBe(i);
			expect(fieldOf(row, "0x000007")).toBe(i);
			expect(fieldOf(row, "0x00001e")).toBe(255);
		});
		// f11 climbs then drops off the last two rows.
		const f11 = rows.map((r) => fieldOf(r, "0x00000b"));
		expect(f11).toEqual([1, 2, 3, 3, 4, 5, undefined, undefined]);
	});
});
