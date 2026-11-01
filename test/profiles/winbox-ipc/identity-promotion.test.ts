// Phase D promotion replay: /system/identity [24,1] on 7.25.
//
// The schema entries under test live in profiles/winbox-ipc/gui-handlers.yaml
// (system-identity) and profiles/winbox-ipc/std-commands.yaml (CMD_SET). The
// wire bytes live in fixtures/winbox-ipc/7.25-set-24-1-identity.json, sanitized
// from work/2026-11-winbox-attributes/proof/7.25-identity/ captures.
//
// Rule: expected names come from the YAML, never from hardcoded labels. The
// mini parser below is independent of the work/ harness decoder.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

interface FixtureEntry {
	key: string;
	tcode: string;
	value: unknown;
}

interface FixtureRecord {
	id: string;
	role: string;
	source: string;
	hex: string;
	cmd: number | null;
	to: number[] | null;
	from: number[] | null;
	reqId: number | null;
	entries: FixtureEntry[];
}

interface Fixture {
	provenance: { report: string; routeros_version: string; route: number[] };
	records: FixtureRecord[];
}

function repoPath(rel: string): string {
	return fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
}

function loadGuiHandlers(): GuiHandlersDoc {
	return parseYaml(
		readFileSync(repoPath("profiles/winbox-ipc/gui-handlers.yaml"), "utf8"),
	) as GuiHandlersDoc;
}

function loadCommands(): CommandsDoc {
	return parseYaml(
		readFileSync(repoPath("profiles/winbox-ipc/std-commands.yaml"), "utf8"),
	) as CommandsDoc;
}

function loadFixture(): Fixture {
	return JSON.parse(
		readFileSync(
			repoPath("fixtures/winbox-ipc/7.25-set-24-1-identity.json"),
			"utf8",
		),
	) as Fixture;
}

type Tlv =
	| { key: number; tcode: number; value: boolean }
	| { key: number; tcode: number; value: number }
	| { key: number; tcode: number; value: number[] }
	| { key: number; tcode: number; value: string }
	| { key: number; tcode: number; value: string[] };

function hexBytes(hex: string): Uint8Array {
	const pairs = hex.match(/.{2}/g);
	if (!pairs) throw new Error("empty hex fixture");
	return Uint8Array.from(pairs.map((b) => Number.parseInt(b, 16)));
}

function parseM2(buf: Uint8Array): Tlv[] {
	if (buf[0] !== 0x4d || buf[1] !== 0x32) throw new Error("missing M2 magic");
	const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const text = new TextDecoder();
	const out: Tlv[] = [];
	let p = 2;
	while (p < buf.length) {
		const keyLow = buf[p] as number;
		const keyHigh = buf[p + 1] as number;
		const ns = buf[p + 2] as number;
		const tcode = buf[p + 3] as number;
		p += 4;
		const key = (ns << 16) | (keyHigh << 8) | keyLow;
		switch (tcode) {
			case 0x00:
				out.push({ key, tcode, value: false });
				break;
			case 0x01:
				out.push({ key, tcode, value: true });
				break;
			case 0x09:
				out.push({ key, tcode, value: buf[p] as number });
				p += 1;
				break;
			case 0x08:
				out.push({ key, tcode, value: dv.getUint32(p, true) });
				p += 4;
				break;
			case 0x21: {
				const len = buf[p] as number;
				p += 1;
				out.push({ key, tcode, value: text.decode(buf.slice(p, p + len)) });
				p += len;
				break;
			}
			case 0x88: {
				const count = dv.getUint16(p, true);
				p += 2;
				const arr: number[] = [];
				for (let i = 0; i < count; i++) {
					arr.push(dv.getUint32(p, true));
					p += 4;
				}
				out.push({ key, tcode, value: arr });
				break;
			}
			case 0xa0: {
				const count = dv.getUint16(p, true);
				p += 2;
				const arr: string[] = [];
				for (let i = 0; i < count; i++) {
					const len = dv.getUint16(p, true);
					p += 2;
					arr.push(text.decode(buf.slice(p, p + len)));
					p += len;
				}
				out.push({ key, tcode, value: arr });
				break;
			}
			default:
				throw new Error(`unhandled tcode 0x${tcode.toString(16)} at ${p - 4}`);
		}
	}
	return out;
}

function fmtKey(key: number): string {
	return `0x${key.toString(16).padStart(6, "0")}`;
}

function fmtTcode(tcode: number): string {
	return `0x${tcode.toString(16)}`;
}

interface FieldDef {
	name: string;
	access?: string;
	"cli-alias"?: string;
}

interface GuiHandlersDoc {
	handlers: Record<
		string,
		{
			fields: { map: Record<string, FieldDef> };
			set: { cmd: { value: number }; versions: string[] };
			evidence: Array<{ ref: string }>;
		}
	>;
}

interface CommandsDoc {
	commands: Record<string, { "canonical-name"?: string }>;
}

function required<T>(value: T | undefined, what: string): T {
	if (value === undefined) throw new Error(`promotion test: missing ${what}`);
	return value;
}

function identityHandler(doc: GuiHandlersDoc): {
	fields: Map<number, FieldDef>;
	setCmd: number;
	setVersions: string[];
} {
	const identity = required(
		doc.handlers["system-identity"],
		"handlers.system-identity",
	);
	const fields = new Map<number, FieldDef>();
	for (const [raw, def] of Object.entries(identity.fields.map)) {
		fields.set(Number(raw), def);
	}
	return {
		fields,
		setCmd: identity.set.cmd.value,
		setVersions: identity.set.versions,
	};
}

function resolveName(
	fields: Map<number, FieldDef>,
	key: number,
): { name: string } | { name: null; fallback: string } {
	const ns = (key >>> 16) & 0xff;
	if (ns !== 0x00) return { name: null, fallback: fmtKey(key) };
	const def = fields.get(key & 0xffff);
	if (!def) return { name: null, fallback: fmtKey(key) };
	return { name: def.name };
}

function userValue(entries: Tlv[], key: number): unknown {
	return entries.find((e) => e.key === key)?.value;
}

describe("identity promotion replay", () => {
	test("schema carries the promoted [24,1] mapping", () => {
		const gui = loadGuiHandlers();
		const { fields, setCmd, setVersions } = identityHandler(gui);
		const nameField = fields.get(12);
		const versionField = fields.get(13);
		expect(nameField?.name).toBe("name");
		expect(nameField?.access).toBe("read-write");
		expect(nameField?.["cli-alias"]).toBe("/system/identity name");
		expect(versionField?.name).toBe("version");
		expect(versionField?.access).toBe("read-only");
		// A UI write control is enabled exactly for read-write fields.
		expect(nameField?.access === "read-write").toBe(true);
		expect(versionField?.access === "read-write").toBe(false);

		const cmds = loadCommands();
		const setEntry = required(
			cmds.commands[String(0xfe000e)],
			"commands[0xfe000e]",
		);
		expect(setEntry["canonical-name"]).toBe("CMD_SET");
		expect(setCmd).toBe(0xfe000e);
		expect(setVersions).toContain("7.25");
	});

	test("promoted evidence references resolve to tracked files", () => {
		const gui = loadGuiHandlers();
		const identity = required(
			gui.handlers["system-identity"],
			"handlers.system-identity",
		);
		const refs = identity.evidence.map((e) => e.ref).join("\n");
		expect(refs).toContain("proof/7.25-identity");
		for (const rel of [
			"work/2026-11-winbox-attributes/proof/7.25-identity/report.yaml",
			"work/2026-11-winbox-attributes/proof/7.25-identity/step-05-ro-probe.jsonl",
			"work/2026-11-winbox-attributes/proof/7.25-identity/step-06-native-set.jsonl",
			"work/2026-11-winbox-attributes/candidates.yaml",
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture();
		expect(fixture.provenance.routeros_version).toBe("7.25");
		expect(fixture.records.length).toBe(7);
		for (const record of fixture.records) {
			const decoded = parseM2(hexBytes(record.hex));
			expect(decoded.map((e) => fmtKey(e.key))).toEqual(
				record.entries.map((e) => e.key),
			);
			expect(decoded.map((e) => fmtTcode(e.tcode))).toEqual(
				record.entries.map((e) => e.tcode),
			);
			const actual: unknown[] = decoded.map((e) => e.value);
			const recorded: unknown[] = record.entries.map((e) => e.value);
			expect(actual).toEqual(recorded);
		}
	});

	test("schema names discriminate the proven write from the no-op", () => {
		const gui = loadGuiHandlers();
		const { fields, setCmd } = identityHandler(gui);
		const fixture = loadFixture();
		const byId = new Map(fixture.records.map((r) => [r.id, r]));

		// SET requests on the wire carry the schema's set verb.
		for (const id of ["ro-probe-set-tx", "native-set-tx"]) {
			expect(byId.get(id)?.cmd).toBe(setCmd);
		}

		// Field 12 (schema-resolved) moves only under the effective SET.
		const baseline = parseM2(
			hexBytes(byId.get("baseline-get-reply")?.hex ?? ""),
		);
		const afterProbe = parseM2(
			hexBytes(byId.get("ro-probe-verify-get")?.hex ?? ""),
		);
		const afterNative = parseM2(
			hexBytes(byId.get("native-set-verify-get")?.hex ?? ""),
		);
		expect(resolveName(fields, 0x00000c)).toEqual({ name: "name" });
		expect(userValue(afterProbe, 0x00000c)).not.toBe(
			userValue(afterNative, 0x00000c),
		);
		expect(userValue(afterNative, 0x00000c)).toBe("m2ir-native-w1");

		// Field 13 (schema-resolved) is constant across every GET reply.
		expect(resolveName(fields, 0x00000d)).toEqual({ name: "version" });
		for (const entries of [baseline, afterProbe, afterNative]) {
			expect(userValue(entries, 0x00000d)).toBe("7.25");
		}
	});

	test("both SET replies share one SYS-only shape", () => {
		const fixture = loadFixture();
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const shapes: string[][] = [];
		for (const id of ["ro-probe-set-ack", "native-set-ack"]) {
			const decoded = parseM2(hexBytes(byId.get(id)?.hex ?? ""));
			// No USER-namespace payload, no statusWord: status proves nothing.
			expect(decoded.filter((e) => ((e.key >>> 16) & 0xff) === 0x00)).toEqual(
				[],
			);
			shapes.push(decoded.map((e) => `${fmtKey(e.key)}/${fmtTcode(e.tcode)}`));
		}
		expect(shapes[0]).toEqual(shapes[1]);
	});

	test("keys outside schema coverage fall back to numeric form", () => {
		const gui = loadGuiHandlers();
		const { fields } = identityHandler(gui);
		// Consumer-level check only: 0x99 never appeared on the wire here.
		expect(resolveName(fields, 0x000099)).toEqual({
			name: null,
			fallback: "0x000099",
		});
	});
});
