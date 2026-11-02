// Handler-tail static promotion anchor (Phase I read-only integration).
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (boot-flags-24-10, unknown-20-134).
// Both promotions rest on already-tracked Phase §§16-39 evidence: literal
// /rw probe paths in sys2 slot-9 plus version-scoped live transcripts, and
// the m2mark1 insert fixture plus the one-factory build. No new wire bytes
// were captured, so this test pins the promoted names/ids/shapes and the
// resolution of every cited evidence file — it does not replay hex.
//
// Rule: expected names come from the YAML, never from hardcoded labels.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

interface SingletonFieldDef {
	name: string;
	tcode: string;
	role: string;
	source?: string;
}

interface RegistryFieldDef {
	name: string;
	tcode: string;
	role: string;
}

interface GuiHandlersDoc {
	handlers: Record<
		string,
		{
			"sys-to": number[];
			status?: string;
			fields: {
				namespace?: string;
				map?: Record<string, SingletonFieldDef>;
				"row-id"?: { namespace: string; field: number };
				"namespace-session"?: Record<string, RegistryFieldDef>;
			};
			evidence: Array<{ ref: string }>;
		}
	>;
}

function repoPath(rel: string): string {
	return fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
}

function loadGuiHandlers(): GuiHandlersDoc {
	return parseYaml(
		readFileSync(repoPath("profiles/winbox-ipc/gui-handlers.yaml"), "utf8"),
	) as GuiHandlersDoc;
}

function required<T>(value: T | undefined, what: string): T {
	if (value === undefined) throw new Error(`promotion test: missing ${what}`);
	return value;
}

describe("handler-tail static promotion", () => {
	test("schema carries boot-flags [24,10] f1/f2 probe meanings", () => {
		const gui = loadGuiHandlers();
		const handler = required(
			gui.handlers["boot-flags-24-10"],
			"handlers.boot-flags-24-10",
		);
		expect(handler["sys-to"]).toEqual([24, 10]);
		expect(handler.fields.namespace).toBe("user");
		const map = required(handler.fields.map, "boot-flags-24-10 fields.map");
		const byId = new Map<number, SingletonFieldDef>();
		for (const [raw, def] of Object.entries(map)) {
			byId.set(Number(raw), def);
		}
		const f1 = required(byId.get(1), "boot-flags field 1");
		const f2 = required(byId.get(2), "boot-flags field 2");
		expect(f1.name).toBe("disable-smp-flag");
		expect(f1.tcode).toBe("bool");
		expect(f1.role).toContain("DISABLE_SMP");
		expect(f2.name).toBe("enable-x86-64-flag");
		expect(f2.tcode).toBe("bool");
		expect(f2.role).toContain("ENABLE_X86_64");
	});

	test("schema carries [20,134] registry row-id + mark-name", () => {
		const gui = loadGuiHandlers();
		const handler = required(
			gui.handlers["unknown-20-134"],
			"handlers.unknown-20-134",
		);
		expect(handler["sys-to"]).toEqual([20, 134]);
		const rowId = required(handler.fields["row-id"], "134 row-id");
		expect(rowId.namespace).toBe("session");
		expect(rowId.field).toBe(1);
		const session = required(
			handler.fields["namespace-session"],
			"134 namespace-session",
		);
		const byId = new Map<number, RegistryFieldDef>();
		for (const [raw, def] of Object.entries(session)) {
			byId.set(Number(raw), def);
		}
		const f16 = required(byId.get(16), "134 field 16");
		expect(f16.name).toBe("mark-name");
		expect(f16.tcode).toBe("string");
		expect(f16.role).toContain("0xfe0010");
	});

	test("[20,134] mirrors the sibling mark-registry shape", () => {
		const gui = loadGuiHandlers();
		for (const key of ["packet-mark-registry", "unknown-20-134"]) {
			const handler = required(gui.handlers[key], `handlers.${key}`);
			const rowId = required(handler.fields["row-id"], `${key} row-id`);
			expect(rowId).toEqual({ namespace: "session", field: 1 });
			const session = required(
				handler.fields["namespace-session"],
				`${key} namespace-session`,
			);
			const names = new Map<number, string>();
			for (const [raw, def] of Object.entries(session)) {
				names.set(Number(raw), def.name);
			}
			expect(names.get(16)).toBe("mark-name");
		}
	});

	test("promoted evidence references resolve to tracked files", () => {
		for (const rel of [
			"work/2026-10-chr-extraction/ws3c/ev/6.49-getone-24-10.json",
			"work/2026-10-chr-extraction/ws3c/ev/7.25-getone-24-10.json",
			"work/2026-10-chr-extraction/ws3c/ev/7.25-getone-24-10-bit29.json",
			"work/2026-10-chr-extraction/ws3c/ev/7.25-pert-24-10-pre.json",
			"work/2026-10-chr-extraction/ws3c/ev/7.25-pert-24-10-post.json",
			"work/2026-10-chr-extraction/ws3c/ev/7.25-getone-20-134.json",
			"work/2026-10-chr-extraction/ws3c/ev/7.25-getall-20-134.json",
			"work/2026-10-chr-extraction/ws3c/ev/7.25-getall-20-134-rt.json",
			"work/2026-10-chr-extraction/ws3c/ev/7.25-getall-20-134-m2mark1.json",
			"work/2026-10-chr-extraction/ws3c/ev/7.25-getall-20-5-f137.json",
			"work/2026-10-chr-extraction/ws3c-prober-findings.md",
			"work/2026-10-chr-extraction/net-bridge2-handler-tables.md",
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});
});
