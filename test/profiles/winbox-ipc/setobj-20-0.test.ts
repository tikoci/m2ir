// [20,0] SETOBJ-by-rowid addressing replay (tx shape only).
//
// The schema entries under test live in
// profiles/winbox-ipc/std-commands.yaml (0xfe0003 CMD_SETOBJ) and
// profiles/winbox-ipc/std-keys.yaml (0xfe0001 STD_ID, 0xfe0009
// STD_DESCR). The wire bytes live in
// fixtures/winbox-ipc/7.25-setobj-20-0-tx.json.
//
// Tx-only fixture: table-row SET rides slot-7 SETOBJ addressed by
// 0xfe0001=rowid (NOT name, NOT setone/0xfe000e). No SETOBJ ack
// transcript exists, so this replays the addressing shape only and
// claims NO write effect (status-ok-proves-nothing; no live CHR here).
//
// Rule: expected names come from the YAML, never from hardcoded labels. The
// mini parser (./m2-replay.ts) is independent of the work/ harness decoder.

import { describe, expect, test } from "bun:test";
import {
	decodeFixtureEntries,
	findEntry,
	loadFixture,
	loadYamlDoc,
	required,
	requiredEntry,
} from "./m2-replay";

interface CommandsDoc {
	commands: Record<string, { "canonical-name"?: string; notes?: string }>;
}

interface StdKeysDoc {
	keys: Record<string, { "canonical-name"?: string }>;
}

describe("setobj [20,0] addressing replay", () => {
	test("schema binds SETOBJ + row-id + comment keys", () => {
		const cmds = loadYamlDoc<CommandsDoc>(
			"profiles/winbox-ipc/std-commands.yaml",
		);
		const setobj = required(cmds.commands[String(0xfe0003)], "CMD_SETOBJ");
		expect(setobj["canonical-name"]).toBe("CMD_SETOBJ");
		expect(required(setobj.notes, "CMD_SETOBJ notes")).toContain("0xfe0001");
		expect(cmds.commands[String(0xfe000e)]?.["canonical-name"]).toBe("CMD_SET");

		const std = loadYamlDoc<StdKeysDoc>("profiles/winbox-ipc/std-keys.yaml");
		expect(std.keys[String(0xfe0001)]?.["canonical-name"]).toBe("STD_ID");
		expect(std.keys[String(0xfe0009)]?.["canonical-name"]).toBe("STD_DESCR");
	});

	test("fixture tx hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture("7.25-setobj-20-0-tx.json");
		expect(fixture.records.length).toBe(1);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("row SET addresses 0xfe0001=rowid under CMD_SETOBJ", () => {
		const fixture = loadFixture("7.25-setobj-20-0-tx.json");
		const record = required(fixture.records[0], "setobj-tx-rowid-3");
		const entries = decodeFixtureEntries(record.hex);
		// Slot-7 SETOBJ verb, not the singleton-attr SET path.
		expect(record.cmd).toBe(0xfe0003);
		expect(record.cmd).not.toBe(0xfe000e);
		expect(record.to).toEqual([20, 0]);
		expect(findEntry(entries, "0xff0003")).toBeUndefined();
		// Addressed by row id with a comment payload.
		expect(requiredEntry(entries, "0xfe0001", "STD_ID").value).toBe(3);
		expect(requiredEntry(entries, "0xfe0009", "STD_DESCR").value).toBe(
			"m2oncli",
		);
	});
});
