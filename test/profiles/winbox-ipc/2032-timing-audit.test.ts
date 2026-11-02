// [20,32] timing-evidence audit pin: the G3 decay artifacts support ORDER
// (1->0->0) only — every committed record carries ts:redacted, so no
// duration, rate, or curve-shape reading is artifact-supported.
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (unknown-20-32 H0a notes,
// filter-20-3 H0b notes + static evidence). The audited bytes are the
// committed G3 step files (ws21 7.25); H0a/H0b added zero router contact
// and H-reviewer blind-corroborated both slices.
//
// Rule: expected names come from the YAML, never from hardcoded labels.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
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
			notes?: string;
			role?: string;
			evidence?: { source?: string; ref?: string }[];
		}
	>;
}

const STEP_FILES = [
	"work/2026-11-winbox-attributes/proof/G3-2032-matrix/step-M1.jsonl",
	"work/2026-11-winbox-attributes/proof/G3-2032-matrix/step-M1-confirm.jsonl",
	"work/2026-11-winbox-attributes/proof/G3-2032-matrix/step-M1-confirm2.jsonl",
];

interface StepRecord {
	direction: string;
	ts: string;
	reqId: number;
	to: [number, number] | null;
	from: [number, number] | null;
	decode?: { entries?: { key: string; value: unknown }[] };
}

function stepRecords(rel: string): StepRecord[] {
	return readFileSync(repoPath(rel), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as StepRecord);
}

// The [20,32] GETCOUNT value: tx to [20,32], then the rx sharing its reqId.
function count2032(records: StepRecord[]): number {
	const tx = required(
		records.find(
			(r) => r.direction === "tx" && r.to !== null && r.to[1] === 32,
		),
		"tx to [20,32]",
	);
	const rx = required(
		records.find((r) => r.direction === "rx" && r.reqId === tx.reqId),
		`rx reqId ${tx.reqId}`,
	);
	const entry = required(
		rx.decode?.entries?.find((e) => e.key === "0xfe0019"),
		"0xfe0019 entry",
	);
	if (typeof entry.value !== "number") throw new Error("count not u32");
	return entry.value;
}

describe("[20,32] timing-evidence audit", () => {
	test("schema carries the H0a order-only notes", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const holder = required(gui.handlers["unknown-20-32"], "unknown-20-32");
		expect(required(holder.notes, "holder notes")).toContain(
			"H0a timing-evidence audit",
		);
		expect(required(holder.notes, "holder notes")).toContain(
			"ORDER\n(1->0->0) only",
		);
	});

	test("schema carries the H0b owner confirmation on filter-20-3", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const filter = required(gui.handlers["filter-20-3"], "filter-20-3");
		expect(required(filter.notes, "filter notes")).toContain(
			"H0b static slice",
		);
		expect(required(filter.notes, "filter notes")).toContain("nova/bin/net");
		expect(
			(filter.evidence ?? []).some((e) =>
				(e.ref ?? "").includes("H0b-fd002a-owner-static"),
			),
		).toBe(true);
	});

	test("promoted evidence references resolve to tracked files", () => {
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/H0a-2032-decay-design/report.yaml",
			"work/2026-11-winbox-attributes/proof/H0a-2032-decay-design/fragment.yaml",
			"work/2026-11-winbox-attributes/proof/H0b-fd002a-owner-static/report.yaml",
			"work/2026-11-winbox-attributes/proof/H0b-fd002a-owner-static/sites-disassembly.txt",
			"work/2026-11-winbox-attributes/proof/H-reviewer/report.yaml",
			"work/2026-11-winbox-attributes/proof/H-reviewer/reconstruction-r1.yaml",
			"work/2026-11-winbox-attributes/proof/H-reviewer/reconstruction-r2.yaml",
			...STEP_FILES,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("24/24 step records carry ts:redacted, zero real timestamps", () => {
		let total = 0;
		for (const rel of STEP_FILES) {
			const records = stepRecords(rel);
			expect(records.length).toBe(8);
			for (const record of records) {
				expect(record.ts).toBe("redacted");
				total += 1;
			}
		}
		expect(total).toBe(24);
	});

	test("decay order is 1->0->0 via reqId-correlated [20,32] reads", () => {
		const expected = [1, 0, 0];
		expect(STEP_FILES.length).toBe(expected.length);
		STEP_FILES.forEach((rel, index) => {
			expect(count2032(stepRecords(rel))).toBe(
				required(expected[index], `expected[${index}]`),
			);
		});
	});

	test("zero async records are committed in the decay window", () => {
		for (const rel of STEP_FILES) {
			for (const record of stepRecords(rel)) {
				expect(["tx", "rx"]).toContain(record.direction);
			}
		}
	});
});

const H1 = "7.25-getcount-20-32-h1.json";
const H1_DIR = "work/2026-11-winbox-attributes/proof/H1-decay";

function h1Count(recordId: string): number {
	const fixture = loadFixture(H1);
	const byId = new Map(fixture.records.map((r) => [r.id, r]));
	const rx = decodeFixtureEntries(required(byId.get(recordId), recordId).hex);
	const value = requiredEntry(rx, "0xfe0019", `${recordId} count`).value;
	if (typeof value !== "number") throw new Error(`${recordId} count not u32`);
	return value;
}

function auxField(stepFile: string, key: string): number {
	const records = stepRecords(`${H1_DIR}/${stepFile}`);
	const rx = required(
		records.find(
			(r) => r.direction === "rx" && r.from !== null && r.from[1] === 17,
		),
		`${stepFile} [20,17] rx`,
	);
	const entry = required(
		rx.decode?.entries?.find((e) => e.key === key),
		`${stepFile} ${key}`,
	);
	if (typeof entry.value !== "number")
		throw new Error(`${stepFile} ${key} not u32`);
	return entry.value;
}

describe("[20,32] H1 decay curve", () => {
	test("schema carries the H1 per-add-transient role and notes", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const holder = required(gui.handlers["unknown-20-32"], "unknown-20-32");
		expect(required(holder.role, "holder role")).toContain("PER-ADD TRANSIENT");
		expect(required(holder.notes, "holder notes")).toContain("H1 decay leg");
	});

	test("promoted H1 evidence references resolve to tracked files", () => {
		for (const rel of [
			`${H1_DIR}/report.yaml`,
			`${H1_DIR}/fragment.yaml`,
			`${H1_DIR}/leg-h1.ts`,
			`${H1_DIR}/step-S1.jsonl`,
			`${H1_DIR}/step-Q4.jsonl`,
			`${H1_DIR}/timing-ladder.jsonl`,
			`fixtures/winbox-ipc/${H1}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture(H1);
		expect(fixture.provenance.routeros_version).toBe("7.25");
		expect(fixture.records.length).toBe(10);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("spike1 flat-1 across S1+P1-P5 (read-disturbance killer)", () => {
		for (const s of ["s1", "p1", "p2", "p3", "p4", "p5"]) {
			expect(h1Count(`getcount-20-32-h1-${s}-rx`)).toBe(1);
		}
	});

	test("spike2 Q-series dips 1 then plateaus 2-2-2", () => {
		expect(h1Count("getcount-20-32-h1-q1-rx")).toBe(1);
		expect(h1Count("getcount-20-32-h1-q2-rx")).toBe(2);
		expect(h1Count("getcount-20-32-h1-q3-rx")).toBe(2);
		expect(h1Count("getcount-20-32-h1-q4-rx")).toBe(2);
	});

	test("f15/f206 decouple from [20,32] both directions", () => {
		// S1->P1: main holds 1 while aux drops 2->1.
		expect(h1Count("getcount-20-32-h1-s1-rx")).toBe(1);
		expect(h1Count("getcount-20-32-h1-p1-rx")).toBe(1);
		expect(auxField("step-S1.jsonl", "0x00000f")).toBe(2);
		expect(auxField("step-P1.jsonl", "0x00000f")).toBe(1);
		// Q1->Q2: main moves 1->2 while aux holds 2.
		expect(auxField("step-Q1.jsonl", "0x0000ce")).toBe(2);
		expect(auxField("step-Q2.jsonl", "0x0000ce")).toBe(2);
	});
});
