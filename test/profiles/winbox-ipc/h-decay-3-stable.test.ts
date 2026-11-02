// H-decay-3 announce-backlog leg, outcome A3 stable-untestable: the
// spike reads 1 flat across R0a..R5 plus 54 keep-alive samples over 300s with
// async=0 everywhere, and the matched-traffic negative control reads 0
// flat — with no decay there is no decay/async correlation to test, so
// H-decay-3 stays UNTESTED (neither supported nor dead).
//
// The schema entry under test lives in
// profiles/winbox-ipc/gui-handlers.yaml (unknown-20-32). The wire bytes
// live in fixtures/winbox-ipc/7.25-getcount-20-32-h-decay-3.json (7 spike
// rung + 2 control [20,32] GETCOUNT rx), captured on ws21 (7.25) by the
// H-decay-3 leg (2w+0r) with the fixed write-through ladder.
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
	handlers: Record<string, { role?: string }>;
}

const FIXTURE = "7.25-getcount-20-32-h-decay-3.json";
const I2 = "work/2026-11-winbox-attributes/proof/i2-decay-backlog";

function v32Of(recordId: string): unknown {
	const fixture = loadFixture(FIXTURE);
	const byId = new Map(fixture.records.map((r) => [r.id, r]));
	const rx = decodeFixtureEntries(required(byId.get(recordId), recordId).hex);
	return requiredEntry(rx, "0xfe0019", `${recordId} count`).value;
}

describe("H-decay-3 stable-spike replay", () => {
	test("schema carries the A3 second-stable-spike role", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const h = required(gui.handlers["unknown-20-32"], "unknown-20-32");
		expect(required(h.role, "role")).toContain("SECOND stable-1 spike");
		expect(required(h.role, "role")).toContain("modal shape");
	});

	test("promoted evidence references resolve to tracked files", () => {
		for (const rel of [
			`${I2}/report-execution-h-decay-3.yaml`,
			`${I2}/leg-h-decay-3.yaml`,
			`${I2}/step-ladder.jsonl`,
			`${I2}/timing-ladder.jsonl`,
			`${I2}/step-negative-control.jsonl`,
			`${I2}/timing-negative-control.jsonl`,
			`${I2}/control-S1-read.json`,
			`fixtures/winbox-ipc/${FIXTURE}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture(FIXTURE);
		expect(fixture.provenance.routeros_version).toBe("7.25");
		expect(fixture.records.length).toBe(9);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("spike rungs read flat-1, control reads flat-0", () => {
		for (const rung of ["r0a", "r0b", "r1", "r2", "r3", "r4", "r5"]) {
			expect(v32Of(`getcount-20-32-h-decay-3-spike-${rung}-rx`)).toBe(1);
		}
		expect(v32Of("getcount-20-32-h-decay-3-neg-r0a-rx")).toBe(0);
		expect(v32Of("getcount-20-32-h-decay-3-neg-r5-rx")).toBe(0);
	});
});
