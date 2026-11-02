// Filter-hid discrimination replay: [20,3] tracks filter-row count, [20,32] excluded.
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (filter-20-3, unknown-20-32, and
// the nat-20-5 f40 jump note). The wire bytes live in
// fixtures/winbox-ipc/7.25-getcount-20-3-32.json, derived from the
// work/2026-11-winbox-attributes/proof/E3-W/ filter-find sweeps
// (base/filt/restored) plus the control add/read/remove files that fix
// ground-truth filter cardinality at N=(0,1,0).
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
} from "./m2-replay";

interface GuiHandlersDoc {
	handlers: Record<
		string,
		{
			"sys-to": number[];
			status?: string;
			role?: string;
			notes?: string;
			evidence: Array<{ ref: string }>;
		}
	>;
}

const FIXTURE = "7.25-getcount-20-3-32.json";

describe("filter hid [20,3] replay", () => {
	test("schema carries the filter-20-3 tracker and the 20-32 holder", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const tracker = required(gui.handlers["filter-20-3"], "filter-20-3");
		expect(tracker["sys-to"]).toEqual([20, 3]);
		expect(required(tracker.role, "filter role")).toContain(
			"/ip/firewall/filter",
		);
		expect(required(tracker.notes, "filter notes")).toContain("F0a offline");
		const holder = required(gui.handlers["unknown-20-32"], "unknown-20-32");
		expect(holder["sys-to"]).toEqual([20, 32]);
		expect(holder.status).toBe("role-open");
		expect(required(holder.role, "holder role")).toContain("NOT a filter");
		const nat = required(gui.handlers["nat-20-5"], "nat-20-5");
		expect(required(nat.notes, "nat notes")).toContain("filter-20-3");
	});

	test("promoted evidence references resolve to tracked files", () => {
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/E3-W/step-base-sweep.jsonl",
			"work/2026-11-winbox-attributes/proof/E3-W/step-filter-sweep.jsonl",
			"work/2026-11-winbox-attributes/proof/E3-W/step-filter-restored.jsonl",
			"work/2026-11-winbox-attributes/proof/E3-W/control-filter-find-add.json",
			"work/2026-11-winbox-attributes/proof/E3-W/control-filter-find-read.json",
			"work/2026-11-winbox-attributes/proof/E3-W/control-filter-find-rm.json",
			"work/2026-11-winbox-attributes/proof/F0a-filter-hid/report.yaml",
			"work/2026-11-winbox-attributes/proof/F-reviewer/report.yaml",
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

	test("[20,3] GETCOUNT reads control cardinality 0/1/0", () => {
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const want: Array<[string, number]> = [
			["getcount-20-3-base-rx", 0],
			["getcount-20-3-filt-rx", 1],
			["getcount-20-3-rest-rx", 0],
		];
		for (const [id, value] of want) {
			const rx = decodeFixtureEntries(required(byId.get(id), id).hex);
			const count = requiredEntry(rx, "0xfe0019", `${id} count`);
			expect(count.tcode).toBe("0x9");
			expect(count.value).toBe(value);
		}
	});

	test("[20,32] GETCOUNT runs 0/8/0 and contradicts N=1", () => {
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const want: Array<[string, number]> = [
			["getcount-20-32-base-rx", 0],
			["getcount-20-32-filt-rx", 8],
			["getcount-20-32-rest-rx", 0],
		];
		for (const [id, value] of want) {
			const rx = decodeFixtureEntries(required(byId.get(id), id).hex);
			const count = requiredEntry(rx, "0xfe0019", `${id} count`);
			expect(count.tcode).toBe("0x9");
			expect(count.value).toBe(value);
		}
	});
});
