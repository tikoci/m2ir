// MOVEOBJ destination-as-start replay: [20,5] P-move-1 ok-noop on 7.25.
//
// The schema entry under test lives in
// profiles/winbox-ipc/std-commands.yaml (CMD_MOVEOBJ 0xfe0007 notes).
// The wire bytes live in fixtures/winbox-ipc/7.25-moveobj-p1-20-5.json,
// sanitized from work/2026-11-winbox-attributes/proof/E3-W/.
//
// Rule: expected names come from the YAML, never from hardcoded labels. The
// mini parser (./m2-replay.ts) is independent of the work/ harness decoder.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type { FixtureEntry } from "./m2-replay";
import {
	decodeFixtureEntries,
	loadFixture,
	loadYamlDoc,
	repoPath,
	required,
	requiredEntry,
	rowsOf,
} from "./m2-replay";

interface CommandsDoc {
	commands: Record<string, { "canonical-name"?: string; notes?: string }>;
}

const FIXTURE = "7.25-moveobj-p1-20-5.json";

function rowOrder(hex: string): number[] {
	const decoded = decodeFixtureEntries(hex);
	return rowsOf(requiredEntry(decoded, "0xfe0002", "rows")).map(
		(r: FixtureEntry[]) =>
			requiredEntry(r, "0xfe0001", "rowid").value as number,
	);
}

describe("moveobj P-move-1 [20,5] replay", () => {
	test("schema records the destination-as-start no-op", () => {
		const cmds = loadYamlDoc<CommandsDoc>(
			"profiles/winbox-ipc/std-commands.yaml",
		);
		const move = required(
			cmds.commands[String(0xfe0007)],
			"commands[0xfe0007]",
		);
		expect(move["canonical-name"]).toBe("CMD_MOVEOBJ");
		expect(move.notes).toContain("Destination-as-start");
		expect(move.notes).toContain("H-move-1 disproven");
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture(FIXTURE);
		expect(fixture.provenance.routeros_version).toBe("7.25");
		expect(fixture.records.length).toBe(6);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/E3-W/report.yaml",
			"work/2026-11-winbox-attributes/proof/E3-W/step-move-p1.jsonl",
			`fixtures/winbox-ipc/${FIXTURE}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("P-move-1 tx carries rowid+start and the order never moves", () => {
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const tx = decodeFixtureEntries(
			required(byId.get("move-p1-tx"), "move tx").hex,
		);
		expect(requiredEntry(tx, "0xff0007", "cmd").value).toBe(0xfe0007);
		expect(requiredEntry(tx, "0xfe0001", "obj").value).toBe(7);
		expect(requiredEntry(tx, "0xfe0003", "start").value).toBe(6);
		// Bare ok ack, then byte-identical order before/after.
		const ack = decodeFixtureEntries(
			required(byId.get("move-p1-ack"), "move ack").hex,
		);
		expect(ack.map((e) => e.key)).not.toContain("0xff0004");
		const before = rowOrder(required(byId.get("move-before-rx"), "before").hex);
		const after = rowOrder(required(byId.get("move-after-rx"), "after").hex);
		expect(before).toEqual([6, 7]);
		expect(after).toEqual([6, 7]);
	});
});
