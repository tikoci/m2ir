// MOVEOBJ negative replay: /ip/firewall/nat [20,5] on 7.25.
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (nat-20-5 notes) and
// profiles/winbox-ipc/std-commands.yaml (CMD_MOVEOBJ). The wire bytes live
// in fixtures/winbox-ipc/7.25-moveobj-20-5.json, sanitized from
// work/2026-11-winbox-attributes/proof/7.25-moveobj/.
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
	rowsOf,
} from "./m2-replay";

interface GuiHandlersDoc {
	handlers: Record<
		string,
		{
			"sys-to": number[];
			notes: string;
			evidence: Array<{ ref: string }>;
		}
	>;
}

interface CommandsDoc {
	commands: Record<string, { "canonical-name"?: string; notes?: string }>;
}

const FIXTURE = "7.25-moveobj-20-5.json";

function orderOf(hex: string): string[] {
	const decoded = decodeFixtureEntries(hex);
	const rows = rowsOf(requiredEntry(decoded, "0xfe0002", "rows"));
	return rows.map((row) => {
		const comment = findEntry(row, "0xfe0009")?.value;
		const rowid = findEntry(row, "0xfe0001")?.value;
		return `${String(comment)}#${String(rowid)}`;
	});
}

describe("moveobj [20,5] negative replay", () => {
	test("schema records the rowid-only noop on both sides", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const handler = required(gui.handlers["nat-20-5"], "handlers.nat-20-5");
		expect(handler["sys-to"]).toEqual([20, 5]);
		expect(handler.notes).toContain("rowid alone does not reorder");

		const cmds = loadYamlDoc<CommandsDoc>(
			"profiles/winbox-ipc/std-commands.yaml",
		);
		const move = required(
			cmds.commands[String(0xfe0007)],
			"commands[0xfe0007]",
		);
		expect(move["canonical-name"]).toBe("CMD_MOVEOBJ");
		expect(required(move.notes, "0xfe0007 notes")).toContain("ok-but-noop");
		expect(move.notes).toContain("must not claim reorder support");
	});

	test("promoted evidence references resolve to tracked files", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const handler = required(gui.handlers["nat-20-5"], "handlers.nat-20-5");
		const refs = handler.evidence.map((e) => e.ref).join("\n");
		expect(refs).toContain("proof/7.25-moveobj");
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/7.25-moveobj/report.yaml",
			"work/2026-11-winbox-attributes/proof/7.25-moveobj/step-02-move.jsonl",
			`fixtures/winbox-ipc/${FIXTURE}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture(FIXTURE);
		expect(fixture.provenance.routeros_version).toBe("7.25");
		expect(fixture.records.length).toBe(4);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("rowid-only MOVEOBJ answers ok yet changes no order", () => {
		const cmds = loadYamlDoc<CommandsDoc>(
			"profiles/winbox-ipc/std-commands.yaml",
		);
		const move = required(
			cmds.commands[String(0xfe0007)],
			"commands[0xfe0007]",
		);
		expect(move["canonical-name"]).toBe("CMD_MOVEOBJ");

		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const txRecord = required(byId.get("move-tx"), "move-tx");
		expect(txRecord.cmd).toBe(0xfe0007);
		const tx = decodeFixtureEntries(txRecord.hex);
		// Rowid-only: no USER-namespace position parameter of any kind.
		expect(tx.filter((e) => e.key.startsWith("0x00"))).toEqual([]);
		expect(requiredEntry(tx, "0xfe0001", "rowid").value).toBe(14);

		// The ack is ok-shaped (status + reqid echo, no error).
		const ack = decodeFixtureEntries(
			required(byId.get("move-ack"), "move-ack").hex,
		);
		expect(requiredEntry(ack, "0xff0003", "type").value).toBe(2);
		expect(findEntry(ack, "0xff0004")).toBeUndefined();

		// But the table order is identical before and after.
		const before = orderOf(
			required(byId.get("before-getall"), "before-getall").hex,
		);
		const after = orderOf(
			required(byId.get("after-getall"), "after-getall").hex,
		);
		expect(before).toEqual(["m2ir-mv-1#13", "m2ir-mv-2#14"]);
		expect(after).toEqual(before);
	});
});
