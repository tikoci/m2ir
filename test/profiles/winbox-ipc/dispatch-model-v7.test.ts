// v7 dispatch-model anchor: slot-19=cmdRemoveObj, JT bound 0x1a, DEFAULT->slot 24.
//
// The schema entries under test live in
// profiles/winbox-ipc/std-commands.yaml (dispatch-model role +
// slot-map-v7, UNHANDLED_0x09/0x0a, CMD_SHUTDOWN) and
// profiles/winbox-ipc/commands.yaml (closed v7 open question). This is a
// static slice: the evidence is disassembly/relocation reads of the pinned
// 7.25 x86 libumsg.so recorded in
// work/2026-11-winbox-attributes/proof/F0b-slot19/report.yaml, blind-
// corroborated by proof/F-reviewer/report.yaml. No wire fixture applies.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { loadYamlDoc, repoPath, required } from "./m2-replay";

interface DispatchDoc {
	commands: Record<
		string,
		{
			"canonical-name"?: string;
			notes?: string;
			evidence?: Array<{ ref: string }>;
		}
	>;
	"dispatch-model": {
		role: string;
		"slot-map": Record<string, string>;
		"slot-map-v7": Record<string, string>;
		evidence: Array<{ ref: string }>;
	};
}

interface PrivateDoc {
	"slot-19-private": { "open-questions": string[] };
	"investigation-trail": Array<{ date: string; finding: string }>;
}

describe("v7 dispatch model", () => {
	test("dispatch-model carries the v6/v7 split and the v7 slot map", () => {
		const doc = loadYamlDoc<DispatchDoc>(
			"profiles/winbox-ipc/std-commands.yaml",
		);
		const model = required(doc["dispatch-model"], "dispatch-model");
		expect(model.role).toContain("0x374ec");
		expect(model.role).toContain("0x1a");
		expect(model.role).toContain("slot 24");
		expect(model.role).toContain("does NOT transfer");
		// v6 map untouched.
		expect(model["slot-map"]["19"]).toBe("cmdUnknown");
		expect(model["slot-map"]["24"]).toBe("cmdDisconnected");
		// v7 map: the proven links.
		const v7 = required(model["slot-map-v7"], "slot-map-v7");
		expect(v7["19"]).toBe("cmdRemoveObj");
		expect(v7["20"]).toBe("cmdRemoveObj-overload");
		expect(v7["22"]).toBe("cmdGetCount");
		expect(v7["24"]).toBe("cmdUnknown");
		expect(v7["25"]).toBe("cmdShutdown");
		expect(v7["29"]).toBe("cmdDisconnected");
		expect(v7["16"]).toBe("cmdGetAll");
		expect(v7["17"]).toBe("cmdStopGetAll");
	});

	test("unhandled/shutdown notes are version-scoped", () => {
		const doc = loadYamlDoc<DispatchDoc>(
			"profiles/winbox-ipc/std-commands.yaml",
		);
		const c9 = required(doc.commands[String(0xfe0009)], "0xfe0009");
		expect(required(c9.notes, "0xfe0009 notes")).toContain("slot 24");
		const ca = required(doc.commands[String(0xfe000a)], "0xfe000a");
		expect(required(ca.notes, "0xfe000a notes")).toContain("version-split");
		const c0c = required(doc.commands[String(0xfe000c)], "0xfe000c");
		expect(required(c0c.notes, "0xfe000c notes")).toContain("slot 25");
	});

	test("v7 private-cmd open question is closed with a trail entry", () => {
		const doc = loadYamlDoc<PrivateDoc>("profiles/winbox-ipc/commands.yaml");
		const open = required(
			doc["slot-19-private"]["open-questions"],
			"open-questions",
		).join("\n");
		expect(open).not.toContain("v7 libumsg DEFAULT routing is still open");
		const trail = doc["investigation-trail"].map((t) => t.finding).join("\n");
		expect(trail).toContain("F0b static libumsg7 pass");
	});

	test("promoted evidence references resolve to tracked files", () => {
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/F0b-slot19/report.yaml",
			"work/2026-11-winbox-attributes/proof/F0b-slot19/fragment.yaml",
			"work/2026-11-winbox-attributes/proof/F-reviewer/report.yaml",
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
		const doc = loadYamlDoc<DispatchDoc>(
			"profiles/winbox-ipc/std-commands.yaml",
		);
		const refs = required(doc["dispatch-model"], "dispatch-model")
			.evidence.map((e) => e.ref)
			.join("\n");
		expect(refs).toContain("F0b-slot19/report.yaml");
		expect(refs).toContain(
			"1d471df0c39e81b9ef946f636615e352470bd0da3fbeaf98fb017869b1c46c80",
		);
	});
});
