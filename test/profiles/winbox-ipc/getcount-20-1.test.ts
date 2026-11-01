// GETCOUNT [20,1] replay (6.49.23 + 7.25 + 7.26beta4).
//
// The schema entries under test live in profiles/winbox-ipc/std-keys.yaml
// (0xfe0014 STD_COUNT, 0xfe0019 STD_OBJ_COUNT) and
// profiles/winbox-ipc/std-commands.yaml (CMD_GETCOUNT). The wire bytes live
// in fixtures/winbox-ipc/{6.49,7.25,7.26beta4}-getcount-20-1.json: bare
// GETCOUNT + GETALL baseline + 4 exact-match filter probes per verb
// (f5/f1 match + non-match), sanitized from the queue-1 cap1 manifests.
//
// Precision under test: 0xfe0019 is the GETALL total slot on EVERY
// version — only the GETCOUNT answer slot is version-divided (v6:
// 0xfe0014, v7: 0xfe0019). This is the first live GETCOUNT evidence
// anywhere in the repo.
//
// Rule: expected names come from the YAML, never from hardcoded labels. The
// mini parser (./m2-replay.ts) is independent of the work/ harness decoder.

import { describe, expect, test } from "bun:test";
import {
	decodeFixtureEntries,
	type FixtureEntry,
	findEntry,
	loadFixture,
	loadYamlDoc,
	required,
	requiredEntry,
	rowsOf,
} from "./m2-replay";

interface StdKeysDoc {
	keys: Record<
		string,
		{ "canonical-name"?: string; role?: string; notes?: string }
	>;
}

interface StdCommandsDoc {
	commands: Record<string, { "canonical-name"?: string; notes?: string }>;
}

interface GuiHandlersDoc {
	handlers: Record<
		string,
		{ fields: { "namespace-user"?: Record<string, { name: string }> } }
	>;
}

const V6 = "6.49-getcount-20-1.json";
const V7 = ["7.25-getcount-20-1.json", "7.26beta4-getcount-20-1.json"] as const;
const ALL = [V6, ...V7] as const;

/** USER-namespace key id for a named [20,1] field, from the YAML. */
function userKey(name: string): string {
	const gui = loadYamlDoc<GuiHandlersDoc>(
		"profiles/winbox-ipc/gui-handlers.yaml",
	);
	const user = required(
		required(gui.handlers["ip-address"], "handlers.ip-address").fields[
			"namespace-user"
		],
		"ip-address namespace-user",
	);
	for (const [raw, def] of Object.entries(user)) {
		if (def.name === name) {
			return `0x${Number(raw).toString(16).padStart(6, "0")}`;
		}
	}
	throw new Error(`no [20,1] field named ${name}`);
}

function recordById(name: string, id: string) {
	const fixture = loadFixture(name);
	return required(
		fixture.records.find((r) => r.id === id),
		`${name} ${id}`,
	);
}

describe("getcount [20,1] replay", () => {
	test("schema binds the version-divided answer slots + CMD_GETCOUNT", () => {
		const std = loadYamlDoc<StdKeysDoc>("profiles/winbox-ipc/std-keys.yaml");
		const count = required(std.keys[String(0xfe0014)], "keys[0xfe0014]");
		expect(count["canonical-name"]).toBe("STD_COUNT");
		expect(required(count.role, "0xfe0014 role")).toContain("v6");
		const total = required(std.keys[String(0xfe0019)], "keys[0xfe0019]");
		expect(total["canonical-name"]).toBe("STD_OBJ_COUNT");
		const notes = required(total.notes, "0xfe0019 notes");
		expect(notes).toContain("[20,1]");
		expect(notes).toContain("version-divided");

		const cmds = loadYamlDoc<StdCommandsDoc>(
			"profiles/winbox-ipc/std-commands.yaml",
		);
		const getcount = required(cmds.commands[String(0xfe0015)], "CMD_GETCOUNT");
		expect(getcount["canonical-name"]).toBe("CMD_GETCOUNT");
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		for (const name of ALL) {
			const fixture = loadFixture(name);
			expect(fixture.records.length).toBe(20);
			for (const record of fixture.records) {
				expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
			}
		}
	});

	test("bare GETCOUNT answer slot is version-divided", () => {
		const v6rx = recordById(V6, "getcount-bare-20-1-rx");
		const v6entries = decodeFixtureEntries(v6rx.hex);
		expect(requiredEntry(v6entries, "0xfe0014", "STD_COUNT").value).toBe(1);
		expect(findEntry(v6entries, "0xfe0019")).toBeUndefined();
		// Byte-level, independent of the decoder.
		expect(v6rx.hex).toContain("1400fe");
		expect(v6rx.hex).not.toContain("1900fe");

		for (const name of V7) {
			const rx = recordById(name, "getcount-bare-20-1-rx");
			const entries = decodeFixtureEntries(rx.hex);
			expect(requiredEntry(entries, "0xfe0019", "STD_OBJ_COUNT").value).toBe(1);
			expect(findEntry(entries, "0xfe0014")).toBeUndefined();
			expect(rx.hex).toContain("1900fe");
			expect(rx.hex).not.toContain("1400fe");
		}
	});

	test("GETCOUNT ignores exact-match extras, all versions", () => {
		const probes = [
			"getcount-filtered-f5-match",
			"getcount-filtered-f5-nomatch",
			"getcount-filtered-f1-match",
			"getcount-filtered-f1-nomatch",
		];
		for (const name of ALL) {
			const bare = decodeFixtureEntries(
				recordById(name, "getcount-bare-20-1-rx").hex,
			);
			const seen: { key: string; value: unknown }[] = [];
			for (const stem of probes) {
				// Probe tx carries a USER-namespace extra; match and
				// non-match values genuinely differ.
				const tx = decodeFixtureEntries(recordById(name, `${stem}-tx`).hex);
				const extras = tx.filter((e) => e.key.startsWith("0x00000"));
				expect(extras.length).toBe(1);
				seen.push({
					key: required(extras[0], `${stem} extra`).key,
					value: required(extras[0], `${stem} extra`).value,
				});
				// Probe rx equals the bare rx except the reqid echo.
				const rx = decodeFixtureEntries(recordById(name, `${stem}-rx`).hex);
				const norm = (es: FixtureEntry[]) =>
					es.map((e) => (e.key === "0xff0006" ? { ...e, value: 0 } : e));
				expect(norm(rx)).toEqual(norm(bare));
			}
			// 2 match + 2 non-match probes with distinct values per key.
			expect(
				seen.filter((s) => s.key === userKey("actual-interface")).length,
			).toBe(2);
			expect(seen.filter((s) => s.key === userKey("address")).length).toBe(2);
			const byKey = new Map<string, unknown[]>();
			for (const s of seen) {
				byKey.set(s.key, [...(byKey.get(s.key) ?? []), s.value]);
			}
			for (const values of byKey.values()) {
				expect(new Set(values).size).toBe(2);
			}
		}
	});

	test("GETALL ignores exact-match extras and totals via 0xfe0019, all versions", () => {
		const probes = [
			"getall-filter-probe-f5-match",
			"getall-filter-probe-f5-nomatch",
			"getall-filter-probe-f1-match",
			"getall-filter-probe-f1-nomatch",
		];
		for (const name of ALL) {
			const baseline = rowsOf(
				requiredEntry(
					decodeFixtureEntries(recordById(name, "getall-baseline-20-1-rx").hex),
					"0xfe0002",
					"STD_OBJS",
				),
			);
			expect(baseline.length).toBe(1);
			for (const stem of probes) {
				const rx = decodeFixtureEntries(recordById(name, `${stem}-rx`).hex);
				// Full row back, identical to baseline; total via 0xfe0019
				// on every version (no 0xfe0014 anywhere on GETALL).
				expect(rowsOf(requiredEntry(rx, "0xfe0002", "STD_OBJS"))).toEqual(
					baseline,
				);
				expect(requiredEntry(rx, "0xfe0019", "STD_OBJ_COUNT").value).toBe(1);
				expect(findEntry(rx, "0xfe0014")).toBeUndefined();
			}
			// The match probes genuinely match the row's f5/f1 values.
			const row = required(baseline[0], `${name} baseline row`);
			const f5match = decodeFixtureEntries(
				recordById(name, "getall-filter-probe-f5-match-tx").hex,
			);
			expect(
				requiredEntry(f5match, userKey("actual-interface"), "f5-match extra")
					.value,
			).toBe(requiredEntry(row, userKey("actual-interface"), "row f5").value);
			const f1match = decodeFixtureEntries(
				recordById(name, "getall-filter-probe-f1-match-tx").hex,
			);
			expect(
				requiredEntry(f1match, userKey("address"), "f1-match extra").value,
			).toBe(requiredEntry(row, userKey("address"), "row f1").value);
		}
	});
});
