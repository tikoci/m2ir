// Phase K approved-legs replay: the K7 [20,124] selector-matrix live
// confirmation (14/14 predictions hit, U4 closed at ladder level) and
// the K8 user-tail hunts (H-13-6-B SET-population with fields f1/f2/f3,
// H-13-5-A / H-13-8-A / H-13-9-A driver verdicts).
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml. The wire bytes live in
// fixtures/winbox-ipc/7.25-get-20-124-selector.json (K7 G8 + G1 rx,
// 0w) and fixtures/winbox-ipc/7.25-set-13-6-populated.json (K8
// H-13-6-B key-only + full + any-f1 rx, 2w).
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
			set?: { scope?: string; versions?: string[] };
			fields?: {
				"row-id"?: { namespace: string; field: number };
				"namespace-user"?: Record<string, { name?: string; role?: string }>;
			};
		}
	>;
}

const FX124 = "7.25-get-20-124-selector.json";
const FX136 = "7.25-set-13-6-populated.json";
const K7 = "work/2026-11-winbox-attributes/proof/k7-124-matrix-exec";
const K8 = "work/2026-11-winbox-attributes/proof/k8-user-tail-hunts";

function recordEntries(fixture: string, recordId: string): FixtureEntry[] {
	const fx = loadFixture(fixture);
	const byId = new Map(fx.records.map((r) => [r.id, r]));
	return required(byId.get(recordId), recordId).entries;
}

function fieldOf(
	entries: FixtureEntry[],
	key: string,
): FixtureEntry["value"] | undefined {
	return entries.find((e) => e.key === key)?.value;
}

describe("phase K approved-legs replay", () => {
	test("schema carries the K7 live-confirmation note", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const h = required(gui.handlers["unknown-20-124"], "124");
		expect(required(h.notes, "124 notes")).toContain("14/14");
		expect(required(h.notes, "124 notes")).toContain("live-confirmed");
		expect(required(h.notes, "124 notes")).toContain("ether1 is not veth");
	});

	test("schema carries the K8 hunt verdict notes", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const h5 = required(gui.handlers["unknown-13-5"], "13-5");
		expect(required(h5.notes, "13-5 notes")).toContain("DEAD");
		const h8 = required(gui.handlers["unknown-13-8"], "13-8");
		expect(required(h8.notes, "13-8 notes")).toContain("Group-driver DEAD");
		const h9 = required(gui.handlers["unknown-13-9"], "13-9");
		expect(required(h9.notes, "13-9 notes")).toContain("aaa-toggle-driver");
		expect(required(h9.notes, "13-9 notes")).toContain("INCONCLUSIVE");
		const h6 = required(gui.handlers["user-prefs-13-6"], "13-6");
		expect(required(h6.notes, "13-6 notes")).toContain("Live SET proven");
		expect(required(h6.notes, "13-6 notes")).toContain("any-f1");
	});

	test("schema carries the promoted 13-6 fields and SET block", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const h6 = required(gui.handlers["user-prefs-13-6"], "13-6");
		const user = required(h6.fields?.["namespace-user"], "13-6 user fields");
		expect(required(user["1"], "f1").name).toBe("username");
		expect(required(user["2"], "f2").name).toBe("prefs-blob");
		expect(required(user["3"], "f3").name).toBe("unknown-3");
		expect(required(h6.set?.scope, "13-6 set scope")).toContain("AAAA-map");
		expect(required(h6.set?.versions, "13-6 set versions")).toContain("7.25");
	});

	test("promoted leg evidence references resolve to tracked files", () => {
		for (const rel of [
			`${K7}/census-124.ts`,
			`${K7}/report.yaml`,
			`${K7}/step-124-g8.jsonl`,
			`${K7}/step-124-g1.jsonl`,
			`${K7}/step-124-g5.jsonl`,
			`${K7}/step-124-b1.jsonl`,
			`${K8}/census-hunts.ts`,
			`${K8}/set-136.ts`,
			`${K8}/report.yaml`,
			`${K8}/h135a-step-added.jsonl`,
			`${K8}/h135a-control-add.json`,
			`${K8}/h136b-step-set-key.jsonl`,
			`${K8}/h136b-step-read-full.jsonl`,
			`${K8}/h136b-step-never-seen.jsonl`,
			`${K8}/h138a-step-added.jsonl`,
			`${K8}/h139a-step-toggled.jsonl`,
			`fixtures/winbox-ipc/${FX124}`,
			`fixtures/winbox-ipc/${FX136}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		for (const [name, n] of [
			[FX124, 2],
			[FX136, 3],
		] as const) {
			const fixture = loadFixture(name);
			expect(fixture.provenance.routeros_version).toBe("7.25");
			expect(fixture.records.length).toBe(n);
			for (const record of fixture.records) {
				expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
			}
		}
	});

	test("[20,124] G8 gate and G1 ladder hit replay byte-exact", () => {
		const g8 = recordEntries(FX124, "getcount-20-124-bare-rx");
		expect(fieldOf(g8, "0xff0008")).toBe(16646150);
		expect(fieldOf(g8, "0xff0009")).toBe("no INTERFACE_IDS");
		const g1 = recordEntries(FX124, "getcount-20-124-id2-rx");
		expect(fieldOf(g1, "0xff0008")).toBe(16646150);
		expect(fieldOf(g1, "0xff0009")).toBe("ether1 is not veth");
	});

	test("[13,6] populated shapes replay byte-exact", () => {
		const keyOnly = recordEntries(FX136, "get-13-6-key-only-rx");
		expect(keyOnly.length).toBe(6);
		expect(fieldOf(keyOnly, "0x000001")).toBe("k3-synth-6");
		const full = recordEntries(FX136, "get-13-6-full-rx");
		expect(full.length).toBe(8);
		expect(fieldOf(full, "0x000001")).toBe("k3-synth-6");
		expect(fieldOf(full, "0x000002")).toBe("k3-blob-a");
		expect(fieldOf(full, "0x000003")).toBe(7);
		const userKeys = full
			.filter((e) => !e.key.startsWith("0xff"))
			.map((e) => e.key);
		expect(userKeys).toEqual(["0x000003", "0x000002", "0x000001"]);
		const anyF1 = recordEntries(FX136, "get-13-6-any-f1-rx");
		expect(fieldOf(anyF1, "0x000001")).toBe("k3-synth-6");
		expect(fieldOf(anyF1, "0x000003")).toBe(7);
	});
});
