// Tail census 1b replay: qos-config [20,122] GET-only gating +
// drift-free identity, qos-pfc [20,126] wrap-family gating, the U4b
// GETOBJ selector closure (exact row-id match on singleton row-id 0),
// v6-absent (0xfe0002) scope for 122/126/116/117/120/121, and the U1
// stimulus-hunt stop on default-config [24,8].
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml. The wire bytes live in
// fixtures/winbox-ipc/7.26beta4-qos-u4b-obj0.json ([20,114]/[20,115]
// GETOBJ obj=0 rx via the J1 matrix + [20,126] GETOBJ obj=0 rx via
// the J4 close leg, all on 7.26beta4). All captures are read-only
// (0w) via the J1/J2 census scripts.
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

const FIXTURE = "7.26beta4-qos-u4b-obj0.json";
const J1 = "work/2026-11-winbox-attributes/proof/j1-tail-census-7x";
const J2 = "work/2026-11-winbox-attributes/proof/j2-v6-tail-census";
const J3 = "work/2026-11-winbox-attributes/proof/j3-decay-u1-designs";
const J4 = "work/2026-11-winbox-attributes/proof/j4-126-obj0-close";
const JR = "work/2026-11-winbox-attributes/proof/j-reviewer";

function obj0Entries(recordId: string): FixtureEntry[] {
	const fixture = loadFixture(FIXTURE);
	const byId = new Map(fixture.records.map((r) => [r.id, r]));
	return required(byId.get(recordId), recordId).entries;
}

function fieldOf(
	entries: FixtureEntry[],
	key: string,
): FixtureEntry["value"] | undefined {
	return entries.find((e) => e.key === key)?.value;
}

describe("tail census 1b replay", () => {
	test("schema carries the 1b gating notes", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const h122 = required(gui.handlers["qos-config-20-122"], "qos-122");
		expect(required(h122.notes, "122 notes")).toContain("GET-only");
		expect(required(h122.notes, "122 notes")).toContain("0xFFFFFFFF");
		expect(required(h122.notes, "122 notes")).toContain("v7-only");
		const h126 = required(gui.handlers["qos-pfc-20-126"], "qos-126");
		expect(required(h126.notes, "126 notes")).toContain("wrap family");
		expect(required(h126.notes, "126 notes")).toContain("exact row-id match");
		for (const key of ["qos-profile-20-114", "qos-map-20-115"]) {
			const h = required(gui.handlers[key], key);
			expect(required(h.notes, `${key} notes`)).toContain("exact row-id match");
			expect(required(h.notes, `${key} notes`)).toContain("obj=0");
		}
		for (const key of ["unknown-20-120", "unknown-20-121"]) {
			const h = required(gui.handlers[key], key);
			expect(required(h.notes, `${key} notes`)).toContain("0xfe0002 on all");
			expect(required(h.notes, `${key} notes`)).toContain("v7-only");
		}
	});

	test("schema carries the U1 stimulus-stop note", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const defconf = required(gui.handlers["default-config"], "default-config");
		expect(required(defconf.notes, "defconf notes")).toContain("Stimulus axis");
		expect(required(defconf.notes, "defconf notes")).toContain("netinstall");
		expect(required(defconf.notes, "defconf notes")).toContain("TR-069");
	});

	test("promoted evidence references resolve to tracked files", () => {
		for (const rel of [
			`${J1}/census.ts`,
			`${J1}/report.yaml`,
			`${J1}/step-beta4-122.jsonl`,
			`${J1}/step-725-122.jsonl`,
			`${J1}/step-beta4-126.jsonl`,
			`${J1}/step-725-126.jsonl`,
			`${J1}/step-beta4-u4b-getall.jsonl`,
			`${J1}/step-beta4-u4b-obj0.jsonl`,
			`${J1}/step-beta4-u4b-bare.jsonl`,
			`${J1}/step-beta4-u4b-obj2.jsonl`,
			`${J2}/census.ts`,
			`${J2}/report.yaml`,
			`${J2}/step-649-1b.jsonl`,
			`${J2}/step-649-siblings.jsonl`,
			`${J4}/census.ts`,
			`${J4}/report.yaml`,
			`${J4}/step-beta4-126-obj0.jsonl`,
			`${J3}/u1-ambiguity-stop.yaml`,
			`${JR}/reconstruction-r3.yaml`,
			`fixtures/winbox-ipc/${FIXTURE}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture(FIXTURE);
		expect(fixture.provenance.routeros_version).toBe("7.26beta4");
		expect(fixture.records.length).toBe(3);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("[20,114] obj0 carries the full singleton plus row-id echo", () => {
		const entries = obj0Entries("getobj-20-114-obj0-rx");
		expect(entries.length).toBe(18);
		expect(fieldOf(entries, "0xfe0001")).toBe(0);
		expect(fieldOf(entries, "0x000023")).toBe(true);
		expect(fieldOf(entries, "0x000007")).toBe(1);
		expect(fieldOf(entries, "0x000003")).toBe(0);
		expect(fieldOf(entries, "0xfe0010")).toBe("default");
	});

	test("[20,115] obj0 carries fe-flags plus row-id echo, zero USER fields", () => {
		const entries = obj0Entries("getobj-20-115-obj0-rx");
		expect(entries.length).toBe(12);
		expect(fieldOf(entries, "0xfe0001")).toBe(0);
		expect(fieldOf(entries, "0xfe0010")).toBe("default");
		for (const e of entries) {
			expect(e.key.startsWith("0xff") || e.key.startsWith("0xfe")).toBe(true);
		}
	});

	test("[20,126] obj0 carries the PFC singleton plus row-id echo", () => {
		const entries = obj0Entries("getobj-20-126-obj0-rx");
		expect(entries.length).toBe(17);
		expect(fieldOf(entries, "0xfe0001")).toBe(0);
		expect(fieldOf(entries, "0x000018")).toBe(false);
		expect(fieldOf(entries, "0x000019")).toBe(false);
		expect(fieldOf(entries, "0x000014")).toBe(255);
		expect(fieldOf(entries, "0x000015")).toBe(255);
		expect(fieldOf(entries, "0x000016")).toBe(255);
		expect(fieldOf(entries, "0xfe0010")).toBe("disabled");
	});
});
