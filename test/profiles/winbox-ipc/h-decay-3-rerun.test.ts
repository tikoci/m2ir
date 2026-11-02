// J6 H-decay-3 re-run on a decaying host, outcome B2 decay-zero-async:
// spike2 decays 4/4/3/2-plateau (TIER 1, 61 rx samples) with async=0 on
// every rung, all 54 keep-alive samples, and the drain — decay with zero async
// kills announce-backlog (H-decay-3) and churn-artifact as decay drivers,
// and the 3-level decay kills single-step one-shot in TIER 1.
// Variable-gauge + multi-step one-shot remain as internal mechanisms;
// history-gating is consistent (spike1=2 vs spike2=4); Q1 annex is
// analytically active with Q-neither (H1 dip not replicated).
//
// The schema entry under test lives in
// profiles/winbox-ipc/gui-handlers.yaml (unknown-20-32). The wire bytes
// live in fixtures/winbox-ipc/7.25-getcount-20-32-j6-rerun.json (7 spike
// rung + 2 control [20,32] GETCOUNT rx), captured on ws21 (7.25) by the
// J6 leg (3w+0r) with the fixed write-through ladder.
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
	handlers: Record<string, { role?: string; notes?: string }>;
}

const FIXTURE = "7.25-getcount-20-32-j6-rerun.json";
const J6 = "work/2026-11-winbox-attributes/proof/j6-h-decay-3-rerun";

function v32Of(recordId: string): unknown {
	const fixture = loadFixture(FIXTURE);
	const byId = new Map(fixture.records.map((r) => [r.id, r]));
	const rx = decodeFixtureEntries(required(byId.get(recordId), recordId).hex);
	return requiredEntry(rx, "0xfe0019", `${recordId} count`).value;
}

describe("H-decay-3 re-run decay replay", () => {
	test("schema carries the B2 decay-zero-async role", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const h = required(gui.handlers["unknown-20-32"], "unknown-20-32");
		expect(required(h.role, "role")).toContain("B2-DECAY-ZERO-ASYNC");
		expect(required(h.role, "role")).toContain("announce-backlog is DEAD");
		expect(required(h.notes, "notes")).toContain("Q-neither");
	});

	test("promoted evidence references resolve to tracked files", () => {
		for (const rel of [
			`${J6}/report.yaml`,
			`${J6}/step-ladder.jsonl`,
			`${J6}/timing-ladder.jsonl`,
			`${J6}/console-ladder.txt`,
			`${J6}/step-negative-control.jsonl`,
			`${J6}/step-spike1.jsonl`,
			`${J6}/step-spike1zero.jsonl`,
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

	test("spike rungs decay 4/4/3/2-plateau, control reads flat-0", () => {
		const expected: Record<string, number> = {
			r0a: 4,
			r0b: 4,
			r1: 3,
			r2: 2,
			r3: 2,
			r4: 2,
			r5: 2,
		};
		for (const [rung, value] of Object.entries(expected)) {
			expect(v32Of(`getcount-20-32-j6-rerun-spike-${rung}-rx`)).toBe(value);
		}
		expect(v32Of("getcount-20-32-j6-rerun-neg-r0a-rx")).toBe(0);
		expect(v32Of("getcount-20-32-j6-rerun-neg-r5-rx")).toBe(0);
	});
});
