// GETOBJ [20,1] replay (6.49.23 + 7.25 + 7.26beta4).
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (ip-address: flat-row shape,
// obj=999 UNKNOWNID-without-total, v7-only extras 0x06/0x0b with UNKNOWN
// meanings) and profiles/winbox-ipc/std-errors.yaml (ERROR_UNKNOWNID).
// The wire bytes live in
// fixtures/winbox-ipc/{6.49,7.25,7.26beta4}-getobj-20-1.json (obj=1,
// obj=999, GETALL count=1 first page), sanitized from the queue-1 cap4
// manifests.
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
	rowsOf,
} from "./m2-replay";

interface FieldDef {
	name: string;
	tcode?: string;
	role?: string;
}

interface GuiHandlersDoc {
	handlers: Record<
		string,
		{
			"sys-to": number[];
			fields: {
				"namespace-user"?: Record<string, FieldDef>;
			};
			notes: string;
		}
	>;
}

interface StdErrorsDoc {
	errors: Record<string, { "canonical-name"?: string }>;
}

const ALL = [
	"6.49-getobj-20-1.json",
	"7.25-getobj-20-1.json",
	"7.26beta4-getobj-20-1.json",
] as const;

const GETALL_ROW = {
	"6.49-getobj-20-1.json": "6.49-getcount-20-1.json",
	"7.25-getobj-20-1.json": "7.25-getcount-20-1.json",
	"7.26beta4-getobj-20-1.json": "7.26beta4-getcount-20-1.json",
} as const;

function ipFields(): Map<number, FieldDef> {
	const gui = loadYamlDoc<GuiHandlersDoc>(
		"profiles/winbox-ipc/gui-handlers.yaml",
	);
	const handler = required(gui.handlers["ip-address"], "handlers.ip-address");
	const user = required(handler.fields["namespace-user"], "namespace-user");
	const fields = new Map<number, FieldDef>();
	for (const [raw, def] of Object.entries(user)) {
		fields.set(Number(raw), def);
	}
	return fields;
}

describe("getobj [20,1] replay", () => {
	test("schema carries the flat-row shape + vrf/f11 extras + notes", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const handler = required(gui.handlers["ip-address"], "handlers.ip-address");
		expect(handler["sys-to"]).toEqual([20, 1]);
		const fields = ipFields();
		// v7-only extras: f6 promoted to vrf (E2-W), f11 still UNKNOWN.
		expect(fields.get(6)?.name).toBe("vrf");
		expect(fields.get(6)?.tcode).toBe("u32");
		expect(fields.get(11)?.name).toBe("unknown-11");
		expect(fields.get(11)?.tcode).toBe("bool");
		expect(handler.notes).toContain("FLAT row");
		expect(handler.notes).toContain("WITHOUT the 0xfe0019 total");

		const errs = loadYamlDoc<StdErrorsDoc>(
			"profiles/winbox-ipc/std-errors.yaml",
		);
		expect(errs.errors[String(0xfe0004)]?.["canonical-name"]).toBe(
			"ERROR_UNKNOWNID",
		);
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		for (const name of ALL) {
			const fixture = loadFixture(name);
			expect(fixture.records.length).toBe(6);
			for (const record of fixture.records) {
				expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
			}
		}
	});

	test("obj=1 is a flat row with the GETALL field set, all versions", () => {
		for (const name of ALL) {
			const fixture = loadFixture(name);
			const reply = required(
				fixture.records.find((r) => r.id === "getobj-20-1-obj=1-reply"),
				`${name} obj=1 reply`,
			);
			expect(reply.from).toEqual([20, 1]);
			const entries = decodeFixtureEntries(reply.hex);
			// Flat: no 0xfe0002 wrapper; row fields at top level.
			expect(findEntry(entries, "0xfe0002")).toBeUndefined();
			expect(requiredEntry(entries, "0xfe0001", "row-id").value).toBe(1);

			// Same field set as the GETALL row (same version, cap1
			// baseline fixture): row keys, not envelope keys.
			const rowKeys = entries
				.map((e) => e.key)
				.filter((k) => k.startsWith("0x00000") || k.startsWith("0xfe00"))
				.sort();
			const baseline = loadFixture(
				required(GETALL_ROW[name], `${name} baseline`),
			);
			const baselineRx = required(
				baseline.records.find((r) => r.id === "getall-baseline-20-1-rx"),
				"baseline rx",
			);
			const baselineRow = required(
				rowsOf(
					requiredEntry(
						decodeFixtureEntries(baselineRx.hex),
						"0xfe0002",
						"STD_OBJS",
					),
				)[0],
				"baseline row",
			);
			expect(rowKeys).toEqual(baselineRow.map((e) => e.key).sort());
		}
	});

	test("obj=999 is UNKNOWNID without the total, all versions", () => {
		for (const name of ALL) {
			const fixture = loadFixture(name);
			const reply = required(
				fixture.records.find((r) => r.id === "getobj-20-1-obj=999-reply"),
				`${name} obj=999 reply`,
			);
			const entries = decodeFixtureEntries(reply.hex);
			expect(requiredEntry(entries, "0xff0008", "SYS_ERRNO").value).toBe(
				0xfe0004,
			);
			expect(findEntry(entries, "0xfe0019")).toBeUndefined();
			expect(findEntry(entries, "0xfe0002")).toBeUndefined();
		}
	});

	test("extras 0x06/0x0b ride v7 rows only (f6=vrf=main here, f11 unknown)", () => {
		const fields = ipFields();
		const keyOf = (name: string): string => {
			for (const [id, def] of fields) {
				if (def.name === name) {
					return `0x${id.toString(16).padStart(6, "0")}`;
				}
			}
			throw new Error(`no field named ${name}`);
		};
		for (const name of [
			"7.25-getobj-20-1.json",
			"7.26beta4-getobj-20-1.json",
		]) {
			const fixture = loadFixture(name);
			for (const id of [
				"getobj-20-1-obj=1-reply",
				"getall-count=1-first-page-reply",
			]) {
				const reply = required(
					fixture.records.find((r) => r.id === id),
					`${name} ${id}`,
				);
				const entries = decodeFixtureEntries(reply.hex);
				const rows =
					id === "getobj-20-1-obj=1-reply"
						? [entries]
						: rowsOf(requiredEntry(entries, "0xfe0002", "STD_OBJS"));
				for (const row of rows) {
					// f6 is the row VRF (0 = main on these single-VRF
					// lab rows); f11 stays UNKNOWN (value check only).
					const f6 = requiredEntry(row, keyOf("vrf"), "0x06");
					expect(f6.tcode).toBe("0x9");
					expect(f6.value).toBe(0);
					const f11 = requiredEntry(row, keyOf("unknown-11"), "0x0b");
					expect(f11.tcode).toBe("0x0");
					expect(f11.value).toBe(false);
				}
			}
		}
		const v6 = loadFixture("6.49-getobj-20-1.json");
		for (const id of [
			"getobj-20-1-obj=1-reply",
			"getall-count=1-first-page-reply",
		]) {
			const reply = required(
				v6.records.find((r) => r.id === id),
				`v6 ${id}`,
			);
			const entries = decodeFixtureEntries(reply.hex);
			const rows =
				id === "getobj-20-1-obj=1-reply"
					? [entries]
					: rowsOf(requiredEntry(entries, "0xfe0002", "STD_OBJS"));
			for (const row of rows) {
				expect(findEntry(row, keyOf("vrf"))).toBeUndefined();
				expect(findEntry(row, keyOf("unknown-11"))).toBeUndefined();
			}
		}
	});

	test("count=1 chain is complete with one page and no token", () => {
		for (const name of ALL) {
			const fixture = loadFixture(name);
			const reply = required(
				fixture.records.find((r) => r.id === "getall-count=1-first-page-reply"),
				`${name} count=1 reply`,
			);
			const entries = decodeFixtureEntries(reply.hex);
			expect(
				rowsOf(requiredEntry(entries, "0xfe0002", "STD_OBJS")).length,
			).toBe(1);
			expect(findEntry(entries, "0xfe0003")).toBeUndefined();
			expect(requiredEntry(entries, "0xfe0019", "STD_OBJ_COUNT").value).toBe(1);
		}
	});
});
