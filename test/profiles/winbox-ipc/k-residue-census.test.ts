// Phase K residue census replay: modem-pair [20,107]/[20,61] gating +
// drift-free identity, board-info [24,35] emptiness + v7-only scope,
// user-tail [13,5]/[13,9]/[13,6]/[13,8] gating + miss/singleton
// re-proofs, sys2-residue [24,14]/[24,16]/[2,1] gating + static holder
// trail, the gated-pair [20,124] static selector decode, and the U1
// S7 TR-069 row.
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml. The wire bytes live in
// fixtures/winbox-ipc/7.26beta4-k-residue-gating.json (K0/K1/K2/K3/K4
// beta4 rx via the census scripts, all read-only 0w). The [20,124]
// decode is static-only (no live leg); the K6 divergence sheets are
// designs (unexecuted) and promote nothing.
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

const FIXTURE = "7.26beta4-k-residue-gating.json";
const K0 = "work/2026-11-winbox-attributes/proof/k0-v6-overflow";
const K1 = "work/2026-11-winbox-attributes/proof/k1-modem-pair";
const K2 = "work/2026-11-winbox-attributes/proof/k2-board-info";
const K3 = "work/2026-11-winbox-attributes/proof/k3-user-tail";
const K4 = "work/2026-11-winbox-attributes/proof/k4-sys2-residue";
const K5 = "work/2026-11-winbox-attributes/proof/k5-gated-pair";
const KR = "work/2026-11-winbox-attributes/proof/k-reviewer";

function recordEntries(recordId: string): FixtureEntry[] {
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

describe("phase K residue census replay", () => {
	test("schema carries the K gating notes", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		for (const key of [
			"sim-settings-20-107",
			"dbrd-holder-24-35",
			"unknown-24-14",
			"unknown-24-16",
			"unknown-2-1",
		]) {
			const h = required(gui.handlers[key], key);
			expect(required(h.notes, `${key} notes`)).toContain("GET-only");
			expect(required(h.notes, `${key} notes`)).toContain("0xFFFFFFFF");
		}
		for (const key of ["unknown-13-5", "unknown-13-9"]) {
			const h = required(gui.handlers[key], key);
			expect(required(h.notes, `${key} notes`)).toContain("NOTIMP");
			expect(required(h.notes, `${key} notes`)).toContain("0xFFFFFFFF");
		}
		const h107 = required(gui.handlers["sim-settings-20-107"], "107");
		expect(required(h107.notes, "107 notes")).toContain("v7-only");
		expect(required(h107.notes, "107 notes")).toContain("not the");
		const h61 = required(gui.handlers["modem-aux-20-61"], "61");
		expect(required(h61.notes, "61 notes")).toContain("14/14");
		expect(required(h61.notes, "61 notes")).toContain("UNKNOWNID");
		const h6 = required(gui.handlers["user-prefs-13-6"], "13-6");
		expect(required(h6.notes, "13-6 notes")).toContain("EMPTY");
		const h8 = required(gui.handlers["unknown-13-8"], "13-8");
		expect(required(h8.notes, "13-8 notes")).toContain("singleton");
		const h124 = required(gui.handlers["unknown-20-124"], "124");
		expect(required(h124.notes, "124 notes")).toContain("1005");
		expect(required(h124.notes, "124 notes")).toContain("static-only");
	});

	test("schema carries the K4 holder trail and kill", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const h14 = required(gui.handlers["unknown-24-14"], "24-14");
		expect(required(h14.notes, "24-14 notes")).toContain("/nova/store/health");
		const h16 = required(gui.handlers["unknown-24-16"], "24-16");
		expect(required(h16.notes, "24-16 notes")).toContain("/nova/store/chfont");
		expect(required(h16.notes, "24-16 notes")).toContain("KILLED");
		expect(required(h16.notes, "24-16 notes")).toContain("UNPROVEN");
		const h21 = required(gui.handlers["unknown-2-1"], "2-1");
		expect(required(h21.notes, "2-1 notes")).toContain("mproxy-settings");
	});

	test("promoted evidence references resolve to tracked files", () => {
		for (const rel of [
			`${K0}/census.ts`,
			`${K0}/report.yaml`,
			`${K0}/step-v6-107.jsonl`,
			`${K1}/census.ts`,
			`${K1}/report.yaml`,
			`${K1}/step-beta4-107-getone.jsonl`,
			`${K1}/step-beta4-107-gating.jsonl`,
			`${K1}/step-725-107-getone.jsonl`,
			`${K1}/step-725-107-gating.jsonl`,
			`${K1}/step-beta4-61-f7.jsonl`,
			`${K1}/step-725-61-f7.jsonl`,
			`${K2}/census.ts`,
			`${K2}/report.yaml`,
			`${K2}/step-beta4-24-35.jsonl`,
			`${K2}/step-v6-24-35.jsonl`,
			`${K3}/census.ts`,
			`${K3}/report.yaml`,
			`${K3}/step-beta4-13-5-13-9.jsonl`,
			`${K3}/step-beta4-13-6.jsonl`,
			`${K3}/step-beta4-13-8.jsonl`,
			`${K3}/step-725-13-6.jsonl`,
			`${K4}/census.ts`,
			`${K4}/report.yaml`,
			`${K4}/step-beta4-sys2-residue.jsonl`,
			`${K4}/step-725-sys2-residue.jsonl`,
			`${K5}/report.yaml`,
			`${K5}/leg-124-selector-matrix.yaml`,
			`${KR}/report.yaml`,
			`${KR}/reconstruction-r-k1.yaml`,
			`${KR}/reconstruction-r-k5.yaml`,
			`fixtures/winbox-ipc/${FIXTURE}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture(FIXTURE);
		expect(fixture.provenance.routeros_version).toBe("7.26beta4");
		expect(fixture.records.length).toBe(5);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("[24,35] GETONE is SYS-only empty, GETALL is NOTIMP", () => {
		const one = recordEntries("getone-24-35-beta4-rx");
		expect(one.length).toBe(5);
		for (const e of one) {
			expect(e.key.startsWith("0xff")).toBe(true);
		}
		const all = recordEntries("getall-24-35-beta4-rx");
		expect(fieldOf(all, "0xff0008")).toBe(16646147);
	});

	test("[20,107] GETALL is NOTIMP, not a wrap", () => {
		const entries = recordEntries("getall-20-107-beta4-rx");
		expect(fieldOf(entries, "0xff0008")).toBe(16646147);
		expect(fieldOf(entries, "0xfe0019")).toBe(undefined);
	});

	test("[2,1] and [13,5] GETONE shapes replay byte-exact", () => {
		const mproxy = recordEntries("getone-2-1-beta4-rx");
		expect(fieldOf(mproxy, "0x000002")).toBe(33554432);
		const user = recordEntries("getone-13-5-beta4-rx");
		expect(fieldOf(user, "0x000005")).toEqual([]);
		expect(fieldOf(user, "0x000001")).toBe(false);
		expect(fieldOf(user, "0x000002")).toBe(true);
		expect(fieldOf(user, "0x000004")).toBe(1);
		expect(fieldOf(user, "0x000003")).toBe(0);
	});
});
