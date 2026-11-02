// Bridge-port replay: /interface/bridge/port [16,2] on 7.25 + 6.49.23.
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (bridge-port fields + set:/add:/
// remove:) and profiles/winbox-ipc/std-commands.yaml
// (CMD_SETOBJ/CMD_ADDOBJ/CMD_REMOVEOBJ). The wire bytes live in
// fixtures/winbox-ipc/7.25-bridge-port-16-2.json and
// fixtures/winbox-ipc/6.49-bridge-port-16-2.json, sanitized from
// work/2026-11-winbox-attributes/proof/7.25-e1-bridges/.
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

interface FieldDef {
	name: string;
	tcode: string;
	role?: string;
}

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
				"namespace-user": Record<string, FieldDef>;
				"namespace-session": Record<string, FieldDef>;
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

const FIXTURE_V7 = "7.25-bridge-port-16-2.json";
const FIXTURE_V6 = "6.49-bridge-port-16-2.json";

function portHandler(doc: GuiHandlersDoc) {
	return required(doc.handlers["bridge-port"], "handlers.bridge-port");
}

function firstRowOf(hex: string) {
	const decoded = decodeFixtureEntries(hex);
	const rows = rowsOf(requiredEntry(decoded, "0xfe0002", "rows"));
	return required(rows[0], "single port row");
}

describe("bridge-port [16,2] replay", () => {
	test("schema carries the promoted 40-key census and verbs", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const handler = portHandler(gui);
		expect(handler["sys-to"]).toEqual([16, 2]);
		// 34 user + 5 session field entries = the 40-key row minus row-id.
		expect(Object.keys(handler.fields["namespace-user"])).toHaveLength(34);
		expect(Object.keys(handler.fields["namespace-session"])).toHaveLength(5);
		// Mapped names resolve from the schema, not the test.
		expect(handler.fields["namespace-user"]["3"]?.name).toBe("interface");
		expect(handler.fields["namespace-user"]["4"]?.name).toBe("bridge");
		expect(handler.fields["namespace-user"]["19"]?.name).toBe("pvid");
		expect(handler.fields["namespace-session"]["5"]?.name).toBe("unknown-5");
		expect(handler.set.cmd.value).toBe(0xfe0003);
		expect(handler.add.cmd.value).toBe(0xfe0005);
		expect(handler.remove.cmd.value).toBe(0xfe0006);
		for (const verb of [handler.set, handler.add, handler.remove]) {
			expect(verb.versions).toContain("7.25");
		}

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
		const refs = portHandler(gui)
			.evidence.map((e) => e.ref)
			.join("\n");
		expect(refs).toContain("proof/7.25-e1-bridges");
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/7.25-e1-bridges/report.yaml",
			"work/2026-11-winbox-attributes/proof/7.25-e1-bridges/control-w1.json",
			"work/2026-11-winbox-attributes/proof/7.25-e1-bridges/control-w3.json",
			"work/2026-11-winbox-attributes/proof/7.25-e1-bridges/control-w8.json",
			`fixtures/winbox-ipc/${FIXTURE_V7}`,
			`fixtures/winbox-ipc/${FIXTURE_V6}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		for (const [name, version, count] of [
			[FIXTURE_V7, "7.25", 11],
			[FIXTURE_V6, "6.49.23", 2],
		] as const) {
			const fixture = loadFixture(name);
			expect(fixture.provenance.routeros_version).toBe(version);
			expect(fixture.records.length).toBe(count);
			for (const record of fixture.records) {
				expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
			}
		}
	});

	test("W1 row carries exactly the schema census with rowid roles", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const handler = portHandler(gui);
		const fixture = loadFixture(FIXTURE_V7);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const row = firstRowOf(
			required(byId.get("w1-row-getall"), "w1-row-getall").hex,
		);
		expect(row).toHaveLength(40);
		// Every schema field entry appears on the wire under its own key.
		for (const [ns, base] of [
			["namespace-user", 0x000000],
			["namespace-session", 0xfe0000],
		] as const) {
			for (const id of Object.keys(handler.fields[ns])) {
				const key = `0x${(base + Number(id)).toString(16).padStart(6, "0")}`;
				expect(
					findEntry(row, key),
					`schema ${ns}.${id} on the wire`,
				).toBeDefined();
			}
		}
		// Row-id roles: f3=ether rowid, f4=bridge rowid, rowid 0, pvid 1.
		expect(requiredEntry(row, "0x000003", "f3").value).toBe(2);
		expect(requiredEntry(row, "0x000004", "f4").value).toBe(4);
		expect(requiredEntry(row, "0xfe0001", "rowid").value).toBe(0);
		expect(requiredEntry(row, "0x000013", "f19/pvid").value).toBe(1);
		expect(requiredEntry(row, "0xfe0005", "0xfe0005").value).toBe(0xffffffff);
	});

	test("v6 row is the strict 32-key subset with the 0x15 drift", () => {
		const fixture = loadFixture(FIXTURE_V6);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const row = firstRowOf(
			required(byId.get("w8-row-getall"), "w8-row-getall").hex,
		);
		expect(row).toHaveLength(32);
		const keys = new Set(row.map((e) => e.key));
		// v7-only keys absent; v6-only set empty (checked against the v7 row).
		for (const k of [
			"0x000020",
			"0x000021",
			"0x000022",
			"0x000023",
			"0x000025",
			"0x000026",
			"0x000027",
			"0x000028",
		]) {
			expect(keys.has(k)).toBe(false);
		}
		const v7 = loadFixture(FIXTURE_V7);
		const v7keys = new Set(
			firstRowOf(
				required(
					new Map(v7.records.map((r) => [r.id, r])).get("w1-row-getall"),
					"w1-row-getall",
				).hex,
			).map((e) => e.key),
		);
		for (const k of keys) expect(v7keys.has(k)).toBe(true);
		// Sole shared-key drift + version-local rowids.
		expect(requiredEntry(row, "0x000015", "0x15").value).toBe(false);
		expect(requiredEntry(row, "0x000003", "f3").value).toBe(1);
		expect(requiredEntry(row, "0x000004", "f4").value).toBe(2);
		expect(requiredEntry(row, "0xfe0001", "rowid").value).toBe(0);
	});

	test("ADD answers rowid 0 and the row reads back", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const handler = portHandler(gui);
		const fixture = loadFixture(FIXTURE_V7);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));

		const tx = decodeFixtureEntries(
			required(byId.get("w3-add-tx"), "w3-add-tx").hex,
		);
		expect(required(byId.get("w3-add-tx"), "w3-add-tx").cmd).toBe(
			handler.add.cmd.value,
		);
		expect(requiredEntry(tx, "0x000003", "f3").value).toBe(2);
		expect(requiredEntry(tx, "0x000004", "f4").value).toBe(7);

		const ack = decodeFixtureEntries(
			required(byId.get("w3-add-ack"), "w3-add-ack").hex,
		);
		expect(requiredEntry(ack, "0xfe0001", "new rowid").value).toBe(0);

		const row = firstRowOf(
			required(byId.get("w3-add-verify-getall"), "w3-add-verify-getall").hex,
		);
		expect(requiredEntry(row, "0xfe0001", "rowid").value).toBe(0);
		expect(requiredEntry(row, "0x000003", "f3").value).toBe(2);
		expect(requiredEntry(row, "0x000004", "f4").value).toBe(7);
	});

	test("SET flips 0xfe000a with a bare ack and REMOVE clears the row", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const handler = portHandler(gui);
		const fixture = loadFixture(FIXTURE_V7);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));

		const setTx = decodeFixtureEntries(
			required(byId.get("w3-set-tx"), "w3-set-tx").hex,
		);
		expect(required(byId.get("w3-set-tx"), "w3-set-tx").cmd).toBe(
			handler.set.cmd.value,
		);
		expect(requiredEntry(setTx, "0xfe0001", "rowid").value).toBe(0);
		expect(requiredEntry(setTx, "0xfe000a", "disabled").value).toBe(true);

		const setAck = decodeFixtureEntries(
			required(byId.get("w3-set-ack"), "w3-set-ack").hex,
		);
		expect(findEntry(setAck, "0xfe0001")).toBeUndefined();

		const pre = decodeFixtureEntries(
			required(byId.get("w3-getobj-pre"), "w3-getobj-pre").hex,
		);
		const post = decodeFixtureEntries(
			required(byId.get("w3-getobj-post"), "w3-getobj-post").hex,
		);
		expect(requiredEntry(pre, "0xfe000a", "pre disabled").value).toBe(false);
		expect(requiredEntry(post, "0xfe000a", "post disabled").value).toBe(true);

		const rmTx = decodeFixtureEntries(
			required(byId.get("w3-remove-tx"), "w3-remove-tx").hex,
		);
		expect(required(byId.get("w3-remove-tx"), "w3-remove-tx").cmd).toBe(
			handler.remove.cmd.value,
		);
		expect(requiredEntry(rmTx, "0xfe0001", "rowid").value).toBe(0);
		const rmAck = decodeFixtureEntries(
			required(byId.get("w3-remove-ack"), "w3-remove-ack").hex,
		);
		expect(findEntry(rmAck, "0xfe0001")).toBeUndefined();

		const empty = decodeFixtureEntries(
			required(byId.get("w3-remove-verify-getall"), "w3-remove-verify-getall")
				.hex,
		);
		expect(rowsOf(requiredEntry(empty, "0xfe0002", "rows"))).toHaveLength(0);
	});
});
