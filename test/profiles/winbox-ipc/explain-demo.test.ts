// Schema-driven consumer check: explain-style resolution over the YAML.
//
// This is the Step-D consumer demonstration, not a second naming inventory:
// every answer below is derived from profiles/winbox-ipc/gui-handlers.yaml
// and profiles/winbox-ipc/std-commands.yaml at test time. It covers a known
// read/write field, an unknown TLV, a composite CLI alias, a version
// mismatch, and a handler verb with a blocked capability. Unknown mappings
// never enable a UI write control.
//
// Example answers (7.25):
//   explain({ route: [20, 5], field: 40 }) -> action, read-write, 11 values
//   explain({ route: [20, 5], field: 999 }) -> unknown 0x0003e7, no write
//   explainCli("/ip/address address") -> [20,1] fields 1 + 3 (composite)
//   explain({ route: [20, 5], field: 40, version: "6.49.23" }) -> mismatch
//   explainVerb(0xfe0007, [20, 5]) -> CMD_MOVEOBJ, reorder unsupported

import { describe, expect, test } from "bun:test";
import { loadYamlDoc, required } from "./m2-replay";

interface FieldDef {
	name?: string;
	access?: string;
	"cli-alias"?: string;
	values?: Record<string, string>;
}

interface HandlerDef {
	"sys-to": number[];
	fields: Record<string, Record<string, FieldDef>>;
	set?: { versions?: string[] };
	add?: { versions?: string[] };
	remove?: { versions?: string[] };
	notes?: string;
	evidence?: Array<{ ref: string }>;
}

interface GuiHandlersDoc {
	handlers: Record<string, HandlerDef>;
}

interface CommandsDoc {
	commands: Record<
		string,
		{ "canonical-name"?: string; confidence?: string; notes?: string }
	>;
}

const FIELD_CONTAINERS = [
	"map",
	"namespace-user",
	"namespace-session",
] as const;

function findHandler(doc: GuiHandlersDoc, route: number[]): HandlerDef {
	for (const handler of Object.values(doc.handlers)) {
		if (
			handler["sys-to"].length === route.length &&
			handler["sys-to"].every((n, i) => n === route[i])
		) {
			return handler;
		}
	}
	throw new Error(`demo: no handler for route [${route.join(",")}]`);
}

function findField(
	handler: HandlerDef,
	field: number,
): { def: FieldDef; container: string } | null {
	for (const container of FIELD_CONTAINERS) {
		const def = handler.fields?.[container]?.[String(field)];
		if (def) return { def, container };
	}
	return null;
}

function versionScope(handler: HandlerDef): string[] {
	return [
		...(handler.set?.versions ?? []),
		...(handler.add?.versions ?? []),
		...(handler.remove?.versions ?? []),
	];
}

function fmtKey(ns: number, field: number): string {
	return `0x${(((ns << 16) | field) >>> 0).toString(16).padStart(6, "0")}`;
}

interface FieldExplanation {
	known: boolean;
	name: string | null;
	fallback: string;
	access: string | null;
	writeEnabled: boolean;
	versionOk: boolean;
	versionScope: string[];
	valueCount: number;
	evidenceCount: number;
}

function explain(query: {
	route: number[];
	ns?: number;
	field: number;
	version?: string;
}): FieldExplanation {
	const gui = loadYamlDoc<GuiHandlersDoc>(
		"profiles/winbox-ipc/gui-handlers.yaml",
	);
	const handler = findHandler(gui, query.route);
	const hit = findField(handler, query.field);
	const fallback = fmtKey(query.ns ?? 0, query.field);
	const scope = versionScope(handler);
	const versionOk =
		query.version === undefined ? true : scope.includes(query.version);
	const known = hit !== null;
	return {
		known,
		name: hit?.def.name ?? null,
		fallback,
		access: hit?.def.access ?? null,
		writeEnabled: known && hit?.def.access === "read-write" && versionOk,
		versionOk,
		versionScope: [...new Set(scope)],
		valueCount: hit?.def.values ? Object.keys(hit.def.values).length : 0,
		evidenceCount: handler.evidence?.length ?? 0,
	};
}

function explainCli(alias: string): Array<{
	handler: string;
	route: number[];
	field: number;
	name: string;
}> {
	const gui = loadYamlDoc<GuiHandlersDoc>(
		"profiles/winbox-ipc/gui-handlers.yaml",
	);
	const out: Array<{
		handler: string;
		route: number[];
		field: number;
		name: string;
	}> = [];
	for (const [handlerName, handler] of Object.entries(gui.handlers)) {
		for (const container of FIELD_CONTAINERS) {
			for (const [raw, def] of Object.entries(
				handler.fields?.[container] ?? {},
			)) {
				if (def["cli-alias"] === alias) {
					out.push({
						handler: handlerName,
						route: handler["sys-to"],
						field: Number(raw),
						name: required(def.name, `${handlerName} ${raw} name`),
					});
				}
			}
		}
	}
	return out;
}

interface VerbExplanation {
	name: string | null;
	confidence: string | null;
	handlerMentionsVerb: boolean;
	reorderSupported: boolean;
	warnings: string[];
}

function explainVerb(cmd: number, route: number[]): VerbExplanation {
	const cmds = loadYamlDoc<CommandsDoc>(
		"profiles/winbox-ipc/std-commands.yaml",
	);
	const entry = cmds.commands[String(cmd)] ?? {};
	const gui = loadYamlDoc<GuiHandlersDoc>(
		"profiles/winbox-ipc/gui-handlers.yaml",
	);
	const notes = findHandler(gui, route).notes ?? "";
	const entryNotes = entry.notes ?? "";
	const warnings = [...notes.split("\n"), ...entryNotes.split("\n")]
		.map((l) => l.trim())
		.filter((l) => /noop|UNKNOWN|must not claim/i.test(l));
	return {
		name: entry["canonical-name"] ?? null,
		confidence: entry.confidence ?? null,
		handlerMentionsVerb:
			!!entry["canonical-name"] && notes.includes(entry["canonical-name"]),
		// A rowid-only client must not claim reorder support (schema note).
		reorderSupported: !/must not claim reorder support/.test(
			`${notes}\n${entryNotes}`,
		),
		warnings,
	};
}

describe("schema-driven consumer demo", () => {
	test("known read/write field enables a write with its value map", () => {
		const answer = explain({ route: [20, 5], field: 40, version: "7.25" });
		expect(answer.known).toBe(true);
		expect(answer.name).toBe("action");
		expect(answer.access).toBe("read-write");
		expect(answer.writeEnabled).toBe(true);
		expect(answer.versionOk).toBe(true);
		expect(answer.valueCount).toBe(11);
		expect(answer.evidenceCount).toBeGreaterThan(0);
	});

	test("unknown TLV falls back to numeric form with no write", () => {
		const answer = explain({ route: [20, 5], field: 999, version: "7.25" });
		expect(answer.known).toBe(false);
		expect(answer.name).toBeNull();
		expect(answer.fallback).toBe("0x0003e7");
		expect(answer.writeEnabled).toBe(false);
	});

	test("read-only field never enables a write", () => {
		const answer = explain({ route: [24, 1], field: 13, version: "7.25" });
		expect(answer.known).toBe(true);
		expect(answer.name).toBe("version");
		expect(answer.writeEnabled).toBe(false);
	});

	test("composite CLI alias resolves to both native fields", () => {
		const hits = explainCli("/ip/address address");
		expect(hits).toEqual([
			{ handler: "ip-address", route: [20, 1], field: 1, name: "address" },
			{ handler: "ip-address", route: [20, 1], field: 3, name: "netmask" },
		]);
	});

	test("version outside the proof scope warns and disables writes", () => {
		const answer = explain({ route: [20, 5], field: 40, version: "6.49.23" });
		expect(answer.known).toBe(true);
		expect(answer.versionOk).toBe(false);
		expect(answer.versionScope).toEqual(["7.25"]);
		expect(answer.writeEnabled).toBe(false);
	});

	test("handler verb surfaces its blocked capability", () => {
		const answer = explainVerb(0xfe0007, [20, 5]);
		expect(answer.name).toBe("CMD_MOVEOBJ");
		expect(answer.confidence).toBe("documented");
		expect(answer.handlerMentionsVerb).toBe(true);
		expect(answer.reorderSupported).toBe(false);
		expect(answer.warnings.length).toBeGreaterThan(0);
	});
});
