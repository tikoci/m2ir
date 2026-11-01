// SYS_STATUS/SYS_ERRNO error-shape replay (NOTIMP + UNKNOWNID + BRKPATH).
//
// The schema entries under test live in profiles/winbox-ipc/sys-keys.yaml
// (SYS_STATUS values, SYS_ERRNO), profiles/winbox-ipc/std-errors.yaml
// (errno names), and profiles/winbox-ipc/std-commands.yaml
// (dispatch-model base rules). The wire bytes live in
// fixtures/winbox-ipc/{6.49,7.25}-error-envelope.json, sanitized from
// work/2026-10-chr-extraction/ws3c/ev/.
//
// No ERROR_FAILED leg exists in ev/ (the token-guard FAILED shape was
// observed live but never dumped) — FAILED replay is unresolved; only the
// YAML name binding is asserted here.
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

interface SysKeysDoc {
	keys: Record<
		string,
		{ "canonical-name"?: string; values?: Record<string, string> }
	>;
}

interface ErrorsDoc {
	errors: Record<string, { "canonical-name"?: string }>;
	"base-handler-rules": { role: string };
}

function errnoName(errno: number): string {
	const doc = loadYamlDoc<ErrorsDoc>("profiles/winbox-ipc/std-errors.yaml");
	return required(
		doc.errors[String(errno)]?.["canonical-name"],
		`errors[${errno}]`,
	);
}

function statusValue(name: string): number {
	const sys = loadYamlDoc<SysKeysDoc>("profiles/winbox-ipc/sys-keys.yaml");
	const values = required(
		sys.keys[String(0xff0004)]?.values,
		"SYS_STATUS values",
	);
	for (const [raw, label] of Object.entries(values)) {
		if (label === name) return Number(raw);
	}
	throw new Error(`no SYS_STATUS value named ${name}`);
}

describe("error envelope replay", () => {
	test("schema binds status, errno key, and errno names", () => {
		const sys = loadYamlDoc<SysKeysDoc>("profiles/winbox-ipc/sys-keys.yaml");
		expect(sys.keys[String(0xff0004)]?.["canonical-name"]).toBe("SYS_STATUS");
		expect(sys.keys[String(0xff0008)]?.["canonical-name"]).toBe("SYS_ERRNO");
		expect(statusValue("ERROR")).toBe(2);

		expect(errnoName(0xfe0002)).toBe("ERROR_BRKPATH");
		expect(errnoName(0xfe0003)).toBe("ERROR_NOTIMP");
		expect(errnoName(0xfe0004)).toBe("ERROR_UNKNOWNID");
		expect(errnoName(0xfe0006)).toBe("ERROR_FAILED");

		const doc = loadYamlDoc<ErrorsDoc>("profiles/winbox-ipc/std-errors.yaml");
		expect(doc["base-handler-rules"].role).toContain("ERROR_NOTIMP");
		expect(doc["base-handler-rules"].role).toContain("ERROR_UNKNOWNID");
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const v6 = loadFixture("6.49-error-envelope.json");
		const v7 = loadFixture("7.25-error-envelope.json");
		expect(v6.records.length).toBe(1);
		expect(v7.records.length).toBe(6);
		for (const record of [...v6.records, ...v7.records]) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("7.25 legs carry ERROR + the schema errno names", () => {
		const error = statusValue("ERROR");
		const fixture = loadFixture("7.25-error-envelope.json");
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const legs: Array<[string, number]> = [
			["set-20-0-notimp", 0xfe0003],
			["get-24-12-notimp", 0xfe0003],
			["getobj-24-2-2-unknownid", 0xfe0004],
			["get-20-61-f7-unknownid", 0xfe0004],
			["get-24-17-brkpath", 0xfe0002],
			["get-2-99-brkpath-short", 0xfe0002],
		];
		expect(legs.length).toBe(fixture.records.length);
		for (const [id, errno] of legs) {
			const record = required(byId.get(id), id);
			const entries = decodeFixtureEntries(record.hex);
			expect(requiredEntry(entries, "0xff0004", `${id} STATUS`).value).toBe(
				error,
			);
			expect(requiredEntry(entries, "0xff0008", `${id} ERRNO`).value).toBe(
				errno,
			);
			// The errno resolves to its schema name (names from YAML).
			expect(typeof errnoName(errno)).toBe("string");
		}
		// The mproxy short shape lacks TYPE + REQID but keeps STATUS.
		const short = required(byId.get("get-2-99-brkpath-short"), "short leg");
		expect(short.reqId).toBeNull();
		expect(
			findEntry(decodeFixtureEntries(short.hex), "0xff0003"),
		).toBeUndefined();
	});

	test("6.49 BRKPATH leg matches the v7 shape minus the banner", () => {
		const error = statusValue("ERROR");
		const v6 = loadFixture("6.49-error-envelope.json");
		const v7 = loadFixture("7.25-error-envelope.json");
		const v6leg = required(v6.records[0], "6.49 brkpath leg");
		const v7leg = required(
			v7.records.find((r) => r.id === "get-24-17-brkpath"),
			"7.25 brkpath leg",
		);
		for (const record of [v6leg, v7leg]) {
			const entries = decodeFixtureEntries(record.hex);
			expect(requiredEntry(entries, "0xff0004", "STATUS").value).toBe(error);
			expect(requiredEntry(entries, "0xff0008", "ERRNO").value).toBe(0xfe0002);
			expect(record.from).toEqual([24]);
		}
		expect(
			findEntry(decodeFixtureEntries(v6leg.hex), "0xff001c"),
		).toBeUndefined();
		expect(
			requiredEntry(decodeFixtureEntries(v7leg.hex), "0xff001c", "banner")
				.value,
		).toEqual(["msg-proxy-7.25"]);
	});
});
