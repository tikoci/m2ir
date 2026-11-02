// Table-row verb replay: /ip/address [20,1] on 7.25.
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (ip-address set:/add:/remove:) and
// profiles/winbox-ipc/std-commands.yaml (CMD_SETOBJ/CMD_ADDOBJ/CMD_REMOVEOBJ).
// The wire bytes live in fixtures/winbox-ipc/7.25-verbs-20-1-ip.json,
// sanitized from work/2026-11-winbox-attributes/proof/7.25-ip-address/.
//
// Rule: expected names come from the YAML, never from hardcoded labels. The
// mini parser (./m2-replay.ts) is independent of the work/ harness decoder.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
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

interface VerbBlock {
	cmd: { value: number; name: string };
	versions: string[];
}

interface GuiHandlersDoc {
	handlers: Record<
		string,
		{
			"sys-to": number[];
			fields: {
				"namespace-user": Record<string, { name: string; tcode: string }>;
				"namespace-session": Record<string, { name: string; tcode: string }>;
			};
			set: VerbBlock;
			add: VerbBlock;
			remove: VerbBlock;
			evidence: Array<{ ref: string }>;
		}
	>;
}

interface CommandsDoc {
	commands: Record<string, { "canonical-name"?: string }>;
}

const FIXTURE = "7.25-verbs-20-1-ip.json";

function ipHandler(doc: GuiHandlersDoc) {
	return required(doc.handlers["ip-address"], "handlers.ip-address");
}

describe("ip verbs [20,1] replay", () => {
	test("schema carries the promoted SET/ADD/REMOVE verbs", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const handler = ipHandler(gui);
		expect(handler["sys-to"]).toEqual([20, 1]);
		expect(handler.set.cmd.value).toBe(0xfe0003);
		expect(handler.add.cmd.value).toBe(0xfe0005);
		expect(handler.remove.cmd.value).toBe(0xfe0006);
		for (const verb of [handler.set, handler.add, handler.remove]) {
			expect(verb.versions).toContain("7.25");
		}
		// Field names resolve from the schema, not the test.
		expect(handler.fields["namespace-session"]["9"]?.name).toBe("comment");
		expect(handler.fields["namespace-user"]["1"]?.name).toBe("address");

		const cmds = loadYamlDoc<CommandsDoc>(
			"profiles/winbox-ipc/std-commands.yaml",
		);
		expect(cmds.commands[String(0xfe0003)]?.["canonical-name"]).toBe(
			"CMD_SETOBJ",
		);
		expect(cmds.commands[String(0xfe0005)]?.["canonical-name"]).toBe(
			"CMD_ADDOBJ",
		);
		expect(cmds.commands[String(0xfe0006)]?.["canonical-name"]).toBe(
			"CMD_REMOVEOBJ",
		);
	});

	test("promoted evidence references resolve to tracked files", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const refs = ipHandler(gui)
			.evidence.map((e) => e.ref)
			.join("\n");
		expect(refs).toContain("proof/7.25-ip-address");
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/7.25-ip-address/report.yaml",
			"work/2026-11-winbox-attributes/proof/7.25-ip-address/step-06-native-set.jsonl",
			"work/2026-11-winbox-attributes/proof/7.25-ip-address/step-06b-native-add.jsonl",
			"work/2026-11-winbox-attributes/proof/7.25-ip-address/step-06c-native-remove.jsonl",
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

	test("SETOBJ writes the schema-resolved comment and reads back", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const handler = ipHandler(gui);
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));

		const tx = decodeFixtureEntries(required(byId.get("set-tx"), "set-tx").hex);
		expect(required(byId.get("set-tx"), "set-tx").cmd).toBe(
			handler.set.cmd.value,
		);
		// Selector + payload, nothing else beyond the envelope.
		expect(requiredEntry(tx, "0xfe0001", "rowid").value).toBe(2);
		const commentKey = Object.entries(handler.fields["namespace-session"]).find(
			([, def]) => def.name === "comment",
		)?.[0];
		expect(commentKey).toBe("9");
		expect(requiredEntry(tx, "0xfe0009", "comment").value).toBe(
			"m2ir-native-w1",
		);

		// The GETALL read-back carries the written value on the same row.
		const verify = decodeFixtureEntries(
			required(byId.get("set-verify-getall"), "set-verify-getall").hex,
		);
		const rows = rowsOf(requiredEntry(verify, "0xfe0002", "rows"));
		const edited = rows.find((row) => findEntry(row, "0xfe0001")?.value === 2);
		expect(findEntry(required(edited, "rowid=2 row"), "0xfe0009")?.value).toBe(
			"m2ir-native-w1",
		);
	});

	test("ADDOBJ stores the sent fields under the answered row id", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const handler = ipHandler(gui);
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));

		const tx = decodeFixtureEntries(required(byId.get("add-tx"), "add-tx").hex);
		expect(required(byId.get("add-tx"), "add-tx").cmd).toBe(
			handler.add.cmd.value,
		);
		const sentAddr = requiredEntry(tx, "0x000001", "address").value;
		const sentMask = requiredEntry(tx, "0x000003", "netmask").value;
		expect(requiredEntry(tx, "0x00000a", "interface").value).toBe(2);

		// Independent surface check: the control plane reads the same
		// dotted quad the native side stored (be32 per the schema).
		const control = JSON.parse(
			readFileSync(
				repoPath(
					"work/2026-11-winbox-attributes/proof/7.25-ip-address/control-06b-native-verify.json",
				),
				"utf8",
			),
		) as { data: Array<{ address: string }> };
		const added = required(
			control.data.find((r) => r.address.startsWith("198.51.100.11/")),
			"control-side added row",
		);
		const octets = required(added.address.split("/")[0], "control address quad")
			.split(".")
			.map(Number);
		expect(octets).toEqual([198, 51, 100, 11]);
		const wire = new DataView(new Uint8Array(4).buffer);
		wire.setUint32(0, sentAddr as number, true);
		expect([0, 1, 2, 3].map((i) => wire.getUint8(i))).toEqual(octets);

		// The ack answers the new row id; the read-back carries the row.
		const ack = decodeFixtureEntries(
			required(byId.get("add-ack"), "add-ack").hex,
		);
		const newRowId = requiredEntry(ack, "0xfe0001", "new rowid").value;
		expect(newRowId).toBe(3);
		const verify = decodeFixtureEntries(
			required(byId.get("add-verify-getall"), "add-verify-getall").hex,
		);
		const rows = rowsOf(requiredEntry(verify, "0xfe0002", "rows"));
		const created = rows.find(
			(row) => findEntry(row, "0xfe0001")?.value === newRowId,
		);
		const createdRow = required(created, "created row");
		expect(findEntry(createdRow, "0x000001")?.value).toBe(sentAddr);
		expect(findEntry(createdRow, "0x000003")?.value).toBe(sentMask);
	});

	test("REMOVEOBJ deletes the row ADDOBJ created", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const handler = ipHandler(gui);
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));

		const addAck = decodeFixtureEntries(
			required(byId.get("add-ack"), "add-ack").hex,
		);
		const created = requiredEntry(addAck, "0xfe0001", "new rowid").value;
		const tx = decodeFixtureEntries(
			required(byId.get("remove-tx"), "remove-tx").hex,
		);
		expect(required(byId.get("remove-tx"), "remove-tx").cmd).toBe(
			handler.remove.cmd.value,
		);
		// Rowid-only selector: no USER-namespace payload at all.
		expect(tx.filter((e) => e.key.startsWith("0x00"))).toEqual([]);
		expect(requiredEntry(tx, "0xfe0001", "rowid").value).toBe(created);

		const verify = decodeFixtureEntries(
			required(byId.get("remove-verify-getall"), "remove-verify-getall").hex,
		);
		const rows = rowsOf(requiredEntry(verify, "0xfe0002", "rows"));
		expect(
			rows.filter((row) => findEntry(row, "0xfe0001")?.value === created),
		).toEqual([]);
	});

	test("all three ack replies share the bare SYS-only shape", () => {
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const shapes: string[][] = [];
		for (const id of ["set-ack", "add-ack", "remove-ack"]) {
			const decoded = decodeFixtureEntries(required(byId.get(id), id).hex);
			// No USER-namespace payload, no statusWord: status proves nothing.
			expect(decoded.filter((e) => e.key.startsWith("0x00"))).toEqual([]);
			expect(findEntry(decoded, "0xff0004")).toBeUndefined();
			shapes.push(decoded.map((e) => `${e.key}/${e.tcode}`));
		}
		expect(shapes[0]).toEqual(shapes[2]);
		// ADD differs only by the answered row id.
		expect(shapes[1]?.filter((s) => !s.startsWith("0xfe0001"))).toEqual(
			shapes[0],
		);
	});
});
