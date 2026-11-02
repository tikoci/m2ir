// Filter jump-value replay: f40 jump=1 / accept=0, f41 jump-target, inverse SETOBJ.
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (filter-20-3 fields + set block,
// unknown-20-32 dataset notes, nat-20-5 f40 jump note). The wire bytes live
// in fixtures/winbox-ipc/7.25-filter-jump-20-3.json, captured on ws21
// (7.25) by the F-jump write leg (5w+0r).
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
	rowsOf,
} from "./m2-replay";

interface GuiHandlersDoc {
	handlers: Record<
		string,
		{
			"sys-to": number[];
			role?: string;
			notes?: string;
			fields?: {
				"namespace-user"?: Record<
					string,
					{ name?: string; values?: Record<string, string> }
				>;
				"namespace-session"?: Record<string, { name?: string }>;
			};
			set?: { versions?: string[] };
		}
	>;
}

const FIXTURE = "7.25-filter-jump-20-3.json";

function getallRows(recordId: string): FixtureEntry[][] {
	const fixture = loadFixture(FIXTURE);
	const byId = new Map(fixture.records.map((r) => [r.id, r]));
	const rx = decodeFixtureEntries(required(byId.get(recordId), recordId).hex);
	return rowsOf(requiredEntry(rx, "0xfe0002", `${recordId} rows`));
}

describe("filter jump value replay", () => {
	test("schema carries the filter f39/f40/f41 fields and set block", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const filter = required(gui.handlers["filter-20-3"], "filter-20-3");
		const user = required(filter.fields?.["namespace-user"], "user fields");
		expect(user["39"]?.name).toBe("chain");
		expect(user["40"]?.name).toBe("action");
		expect(user["40"]?.values).toEqual({ 0: "accept", 1: "jump" });
		expect(user["41"]?.name).toBe("jump-target");
		const session = required(
			filter.fields?.["namespace-session"],
			"session fields",
		);
		expect(session["9"]?.name).toBe("comment");
		expect(session["28"]?.name).toBe("unknown-28");
		expect(filter.set?.versions).toEqual(["7.25"]);
		const holder = required(gui.handlers["unknown-20-32"], "unknown-20-32");
		expect(required(holder.notes, "holder notes")).toContain("5-point");
		const nat = required(gui.handlers["nat-20-5"], "nat-20-5");
		expect(required(nat.notes, "nat notes")).toContain("jump=1 proven");
	});

	test("promoted evidence references resolve to tracked files", () => {
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/F-jump/report.yaml",
			"work/2026-11-winbox-attributes/proof/F-jump/step-j1.jsonl",
			"work/2026-11-winbox-attributes/proof/F-jump/step-j2.jsonl",
			"work/2026-11-winbox-attributes/proof/F-jump/step-j2b.jsonl",
			"work/2026-11-winbox-attributes/proof/F-jump/step-j3.jsonl",
			"work/2026-11-winbox-attributes/proof/F-jump/step-j3read.jsonl",
			"work/2026-11-winbox-attributes/proof/F-jump/control-j1-read.json",
			"work/2026-11-winbox-attributes/proof/F-jump/control-j3-read.json",
			`fixtures/winbox-ipc/${FIXTURE}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture(FIXTURE);
		expect(fixture.provenance.routeros_version).toBe("7.25");
		expect(fixture.records.length).toBe(7);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("J1 jump row carries f40=1 and f41=e3jump", () => {
		const rows = getallRows("getall-j1-rx");
		expect(rows.length).toBe(1);
		const row = required(rows[0], "j1 row");
		expect(requiredEntry(row, "0x000028", "f40").value).toBe(1);
		expect(requiredEntry(row, "0x000029", "f41").value).toBe("e3jump");
		expect(requiredEntry(row, "0x000027", "f39").value).toBe("forward");
		expect(findEntry(row, "0xfd002a")).toBeUndefined();
	});

	test("J2 varies only f41 and gains the 0xfd002a adjunct", () => {
		const rows = getallRows("getall-j2-rx");
		expect(rows.length).toBe(1);
		const row = required(rows[0], "j2 row");
		expect(requiredEntry(row, "0x000028", "f40").value).toBe(1);
		expect(requiredEntry(row, "0x000029", "f41").value).toBe("e3jump2");
		expect(requiredEntry(row, "0xfd002a", "fd002a").value).toBe("");
	});

	test("J2b accept row carries f40=0 with no f41", () => {
		const rows = getallRows("getall-j2b-rx");
		expect(rows.length).toBe(2);
		const accept = required(rows[1], "accept row");
		expect(requiredEntry(accept, "0x000028", "f40").value).toBe(0);
		expect(findEntry(accept, "0x000029")).toBeUndefined();
		expect(findEntry(accept, "0xfd002a")).toBeUndefined();
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const rx = decodeFixtureEntries(
			required(byId.get("getall-j2b-rx"), "j2b rx").hex,
		);
		expect(requiredEntry(rx, "0xfe0019", "count").value).toBe(2);
	});

	test("J3 SETOBJ writes f40=0 and the row keeps f41", () => {
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const tx = decodeFixtureEntries(
			required(byId.get("setobj-j3-tx"), "j3 tx").hex,
		);
		expect(requiredEntry(tx, "0xfe0001", "rowid").value).toBe(1);
		expect(requiredEntry(tx, "0x000028", "f40").value).toBe(0);
		const rows = getallRows("getall-j3read-rx");
		const row = required(rows[0], "post-inverse row");
		expect(requiredEntry(row, "0x000028", "f40").value).toBe(0);
		// Adjunct-retention divergence: control dropped jump-target, native kept it.
		expect(requiredEntry(row, "0x000029", "f41").value).toBe("e3jump2");
	});
});
