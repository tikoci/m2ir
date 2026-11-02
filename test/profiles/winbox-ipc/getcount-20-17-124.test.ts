// GETCOUNT census replay: [20,17] ok+0xFFFFFFFF + [20,124] FAILED on 7.25 + 7.26beta4.
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (neighbor-discovery-settings notes,
// unknown-20-124) and profiles/winbox-ipc/std-commands.yaml (CMD_GETCOUNT).
// The wire bytes live in
// fixtures/winbox-ipc/{7.25,7.26beta4}-getcount-20-17-124.json, sanitized
// from work/2026-11-winbox-attributes/proof/E3-R-census/.
//
// Rule: expected names come from the YAML, never from hardcoded labels. The
// mini parser (./m2-replay.ts) is independent of the work/ harness decoder.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
	decodeFixtureEntries,
	findEntry,
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
			notes?: string;
			evidence: Array<{ ref: string }>;
		}
	>;
}

interface CommandsDoc {
	commands: Record<string, { "canonical-name"?: string; notes?: string }>;
}

const FIXTURE_V7 = "7.25-getcount-20-17-124.json";
const FIXTURE_BETA4 = "7.26beta4-getcount-20-17-124.json";

describe("getcount [20,17]+[20,124] replay", () => {
	test("schema carries the 20-124 holder and the getcount notes", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const holder = required(
			gui.handlers["unknown-20-124"],
			"handlers.unknown-20-124",
		);
		expect(holder["sys-to"]).toEqual([20, 124]);
		expect(holder.status).toBe("role-open");
		const nd = required(
			gui.handlers["neighbor-discovery-settings"],
			"handlers.neighbor-discovery-settings",
		);
		expect(nd.notes).toContain("0xFFFFFFFF");
		const cmds = loadYamlDoc<CommandsDoc>(
			"profiles/winbox-ipc/std-commands.yaml",
		);
		expect(
			required(cmds.commands[String(0xfe0015)], "CMD_GETCOUNT").notes,
		).toContain("no INTERFACE_IDS");
	});

	test("promoted evidence references resolve to tracked files", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const refs = [
			required(gui.handlers["unknown-20-124"], "124"),
			required(gui.handlers["neighbor-discovery-settings"], "17"),
		]
			.flatMap((h) => h.evidence.map((e) => e.ref))
			.join("\n");
		expect(refs).toContain("proof/E3-R-census");
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/E3-R-census/report.yaml",
			"work/2026-11-winbox-attributes/proof/E3-R-census/step-7.25-census.jsonl",
			"work/2026-11-winbox-attributes/proof/E3-R-census/step-7.26beta4-census.jsonl",
			"work/2026-11-winbox-attributes/proof/E2-R-census/report.yaml",
			`fixtures/winbox-ipc/${FIXTURE_V7}`,
			`fixtures/winbox-ipc/${FIXTURE_BETA4}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		for (const [name, version] of [
			[FIXTURE_V7, "7.25"],
			[FIXTURE_BETA4, "7.26beta4"],
		] as const) {
			const fixture = loadFixture(name);
			expect(fixture.provenance.routeros_version).toBe(version);
			expect(fixture.records.length).toBe(4);
			for (const record of fixture.records) {
				expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
			}
		}
	});

	test("[20,17] answers ok + 0xFFFFFFFF on both versions", () => {
		for (const name of [FIXTURE_V7, FIXTURE_BETA4]) {
			const fixture = loadFixture(name);
			const byId = new Map(fixture.records.map((r) => [r.id, r]));
			const rx = decodeFixtureEntries(
				required(byId.get("getcount-20-17-rx"), `${name} 17 rx`).hex,
			);
			// Ok shape: no SYS_STATUS, no errno, no errstr.
			expect(findEntry(rx, "0xff0004")).toBeUndefined();
			expect(findEntry(rx, "0xff0008")).toBeUndefined();
			expect(findEntry(rx, "0xff0009")).toBeUndefined();
			const count = requiredEntry(rx, "0xfe0019", `${name} 17 count`);
			expect(count.tcode).toBe("0x8");
			expect(count.value).toBe(4294967295);
		}
	});

	test("[20,124] answers FAILED + no INTERFACE_IDS on both versions", () => {
		for (const name of [FIXTURE_V7, FIXTURE_BETA4]) {
			const fixture = loadFixture(name);
			const byId = new Map(fixture.records.map((r) => [r.id, r]));
			const rx = decodeFixtureEntries(
				required(byId.get("getcount-20-124-rx"), `${name} 124 rx`).hex,
			);
			expect(requiredEntry(rx, "0xff0004", "status").value).toBe(2);
			expect(requiredEntry(rx, "0xff0008", "errno").value).toBe(16646150);
			expect(requiredEntry(rx, "0xff0009", "errstr").value).toBe(
				"no INTERFACE_IDS",
			);
			// No count slot rides the error reply.
			expect(findEntry(rx, "0xfe0019")).toBeUndefined();
			expect(findEntry(rx, "0xfe0014")).toBeUndefined();
		}
	});
});
