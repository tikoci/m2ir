// [20,32] GETCOUNT dataset pin: the 5-point rule-set values plus the J2
// invariance bonus that G0a's AMBIGUOUS verdict rests on.
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (unknown-20-32 notes + evidence,
// filter-20-3 f40 candidate survey). The wire bytes live in
// fixtures/winbox-ipc/7.25-getcount-20-32-matrix.json (F-jump points,
// extracted from committed proof/F-jump/step-*.jsonl rx line 4) and
// fixtures/winbox-ipc/7.25-getcount-20-3-32.json (the E3-W {accept}->8
// point). All captures are ws21 7.25; G0a added zero router contact.
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
	handlers: Record<string, { notes?: string; role?: string }>;
}

const MATRIX = "7.25-getcount-20-32-matrix.json";
const E3W = "7.25-getcount-20-3-32.json";

function countOf(fixtureFile: string, recordId: string): number {
	const fixture = loadFixture(fixtureFile);
	const byId = new Map(fixture.records.map((r) => [r.id, r]));
	const rx = decodeFixtureEntries(required(byId.get(recordId), recordId).hex);
	const value = requiredEntry(rx, "0xfe0019", `${recordId} count`).value;
	if (typeof value !== "number") throw new Error(`${recordId} count not u32`);
	return value;
}

describe("[20,32] dataset pin", () => {
	test("schema carries the G0a fit notes and G0c candidate survey", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const holder = required(gui.handlers["unknown-20-32"], "unknown-20-32");
		expect(required(holder.notes, "holder notes")).toContain("G0a offline fit");
		expect(required(holder.notes, "holder notes")).toContain("AMBIGUOUS stop");
		const filter = required(gui.handlers["filter-20-3"], "filter-20-3");
		expect(required(filter.notes, "filter notes")).toContain("G0c survey");
		expect(required(filter.notes, "filter notes")).toContain(
			"fasttrack-connection",
		);
	});

	test("promoted evidence references resolve to tracked files", () => {
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/G0a-2032-model/report.yaml",
			"work/2026-11-winbox-attributes/proof/G0a-2032-model/scores.yaml",
			"work/2026-11-winbox-attributes/proof/G0a-2032-model/score-models.ts",
			"work/2026-11-winbox-attributes/proof/G-reviewer/report.yaml",
			"work/2026-11-winbox-attributes/proof/G-reviewer/reconstruction-r1.yaml",
			"work/2026-11-winbox-attributes/proof/G0c-f40-design/report.yaml",
			`fixtures/winbox-ipc/${MATRIX}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture(MATRIX);
		expect(fixture.provenance.routeros_version).toBe("7.25");
		expect(fixture.records.length).toBe(5);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("5-point dataset reads {}->0 {A}->8 {J}->2 {J,A}->1 {A,A}->1", () => {
		expect(countOf(MATRIX, "getcount-20-32-baseline-rx")).toBe(0);
		expect(countOf(E3W, "getcount-20-32-filt-rx")).toBe(8);
		expect(countOf(MATRIX, "getcount-20-32-j1-rx")).toBe(2);
		expect(countOf(MATRIX, "getcount-20-32-j2b-rx")).toBe(1);
		expect(countOf(MATRIX, "getcount-20-32-j3read-rx")).toBe(1);
	});

	test("J2 jump-target vary leaves the value at 2 (hash-killer premise)", () => {
		expect(countOf(MATRIX, "getcount-20-32-j2-rx")).toBe(
			countOf(MATRIX, "getcount-20-32-j1-rx"),
		);
		expect(countOf(MATRIX, "getcount-20-32-j2-rx")).toBe(2);
	});

	test("singleton-forced linear sum fails both 2-rule points", () => {
		const wAccept = countOf(E3W, "getcount-20-32-filt-rx");
		const wJump = countOf(MATRIX, "getcount-20-32-j1-rx");
		const pair = countOf(MATRIX, "getcount-20-32-j2b-rx");
		const acceptPair = countOf(MATRIX, "getcount-20-32-j3read-rx");
		// Residuals, predicted-minus-observed: the G0a headline exhibit.
		expect(wAccept + wJump - pair).toBe(9);
		expect(2 * wAccept - acceptPair).toBe(15);
	});
});

const DECAY = "7.25-getcount-20-32-decay.json";

describe("[20,32] time-varying decay", () => {
	test("schema carries the G3 ambiguity-stop notes", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const holder = required(gui.handlers["unknown-20-32"], "unknown-20-32");
		expect(required(holder.notes, "holder notes")).toContain(
			"G3 ambiguity stop",
		);
		expect(required(holder.role, "holder role")).toContain("TIME-VARYING");
	});

	test("promoted evidence references resolve to tracked files", () => {
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/G3-2032-matrix/report.yaml",
			"work/2026-11-winbox-attributes/proof/G3-2032-matrix/step-M1.jsonl",
			"work/2026-11-winbox-attributes/proof/G3-2032-matrix/step-M1-confirm.jsonl",
			"work/2026-11-winbox-attributes/proof/G3-2032-matrix/step-M1-confirm2.jsonl",
			"work/2026-11-winbox-attributes/proof/G3-2032-matrix/control-M1-read.json",
			`fixtures/winbox-ipc/${DECAY}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture(DECAY);
		expect(fixture.provenance.routeros_version).toBe("7.25");
		expect(fixture.records.length).toBe(3);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("M1 reads 1 then decays 1->0->0 with the rule present", () => {
		expect(countOf(DECAY, "getcount-20-32-M1-rx")).toBe(1);
		expect(countOf(DECAY, "getcount-20-32-confirm-rx")).toBe(0);
		expect(countOf(DECAY, "getcount-20-32-confirm2-rx")).toBe(0);
	});
});
