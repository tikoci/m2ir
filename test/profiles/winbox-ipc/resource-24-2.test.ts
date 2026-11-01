// System-resource [24,2] version-field replay (6.49.23 + 7.25).
//
// The schema entry under test lives in
// profiles/winbox-ipc/gui-handlers.yaml (system-resource: 22 = version,
// 45 = minimum-version). The wire bytes live in
// fixtures/winbox-ipc/{6.49,7.25}-getone-24-2-resource.json, sanitized
// from work/2026-10-chr-extraction/ws3c/ev/{6.49,7.25}-getone-24-2.json.
//
// Per-version counts only (one record per version file); no global
// denominator. Only the version fields are asserted — counters and
// timestamps ride along verbatim for the round-trip check.
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

interface GuiHandlersDoc {
	handlers: Record<
		string,
		{
			"sys-to": number[];
			fields: { map: Record<string, { name: string }> };
		}
	>;
}

function resourceNames(): { version: number; minimumVersion: number } {
	const gui = loadYamlDoc<GuiHandlersDoc>(
		"profiles/winbox-ipc/gui-handlers.yaml",
	);
	const handler = required(
		gui.handlers["system-resource"],
		"handlers.system-resource",
	);
	expect(handler["sys-to"]).toEqual([24, 2]);
	let version = -1;
	let minimumVersion = -1;
	for (const [raw, def] of Object.entries(handler.fields.map)) {
		if (def.name === "version") version = Number(raw);
		if (def.name === "minimum-version") minimumVersion = Number(raw);
	}
	return { version, minimumVersion };
}

const keyOf = (id: number): string => `0x${id.toString(16).padStart(6, "0")}`;

describe("resource [24,2] version replay", () => {
	test("schema carries version + minimum-version field ids", () => {
		const { version, minimumVersion } = resourceNames();
		expect(version).toBe(22);
		expect(minimumVersion).toBe(45);
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const v6 = loadFixture("6.49-getone-24-2-resource.json");
		const v7 = loadFixture("7.25-getone-24-2-resource.json");
		expect(v6.records.length).toBe(1);
		expect(v7.records.length).toBe(1);
		for (const record of [...v6.records, ...v7.records]) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("7.25 carries version + minimum-version", () => {
		const { version, minimumVersion } = resourceNames();
		const fixture = loadFixture("7.25-getone-24-2-resource.json");
		const record = required(fixture.records[0], "7.25 bare-get-reply");
		const entries = decodeFixtureEntries(record.hex);
		expect(record.from).toEqual([24, 2]);
		expect(requiredEntry(entries, keyOf(version), "version").value).toBe(
			"7.25",
		);
		expect(
			requiredEntry(entries, keyOf(minimumVersion), "minimum-version").value,
		).toBe("7.1");
	});

	test("6.49 carries version but no minimum-version", () => {
		const { version, minimumVersion } = resourceNames();
		const fixture = loadFixture("6.49-getone-24-2-resource.json");
		const record = required(fixture.records[0], "6.49 bare-get-reply");
		const entries = decodeFixtureEntries(record.hex);
		expect(record.from).toEqual([24, 2]);
		expect(requiredEntry(entries, keyOf(version), "version").value).toBe(
			"6.49.23 (stable)",
		);
		expect(findEntry(entries, keyOf(minimumVersion))).toBeUndefined();
	});
});
