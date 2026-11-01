// Read-only error census replay (6.49.23 + 7.25 + 7.26beta4).
//
// The schema entries under test live in
// profiles/winbox-ipc/std-errors.yaml (BRKPATH/NOTIMP/UNKNOWNID/FAILED),
// profiles/winbox-ipc/sys-keys.yaml (SYS_ERRSTR 0xff0009, SYS_STATUS
// 0xff0004), and profiles/winbox-ipc/gui-handlers.yaml (unknown-13-9
// tcode fix). The wire bytes live in
// fixtures/winbox-ipc/{6.49,7.25,7.26beta4}-error-census.json: 11
// read-only legs (10 with replies + the [999,1] tx-only timeout) —
// sanitized from the queue-3 cap6 manifests.
//
// First 0xff0009 sighting anywhere: bare GET on [13,6]/[13,7] answers
// FAILED + 'no user name provided'.
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
} from "./m2-replay";

interface StdErrorsDoc {
	errors: Record<string, { "canonical-name"?: string; notes?: string }>;
}

interface SysKeysDoc {
	keys: Record<
		string,
		{ "canonical-name"?: string; role?: string; notes?: string }
	>;
}

interface GuiHandlersDoc {
	handlers: Record<string, { role?: string }>;
}

const V6 = "6.49-error-census.json";
const V7 = ["7.25-error-census.json", "7.26beta4-error-census.json"] as const;
const ALL = [V6, ...V7] as const;

const BRKPATH = 0xfe0002;
const NOTIMP = 0xfe0003;
const UNKNOWNID = 0xfe0004;
const FAILED = 0xfe0006;

function recordById(name: string, id: string) {
	const fixture = loadFixture(name);
	return required(
		fixture.records.find((r) => r.id === id),
		`${name} ${id}`,
	);
}

function errnoOf(entries: FixtureEntry[]): number {
	return requiredEntry(entries, "0xff0008", "SYS_ERRNO").value as number;
}

function fromOf(entries: FixtureEntry[]): unknown {
	return requiredEntry(entries, "0xff0002", "SYS_FROM").value;
}

describe("error census replay", () => {
	test("schema binds the four census error codes + SYS_ERRSTR + u32 fix", () => {
		const errors = loadYamlDoc<StdErrorsDoc>(
			"profiles/winbox-ipc/std-errors.yaml",
		);
		expect(
			required(errors.errors[String(BRKPATH)], "0xfe0002")["canonical-name"],
		).toBe("ERROR_BRKPATH");
		expect(
			required(errors.errors[String(NOTIMP)], "0xfe0003")["canonical-name"],
		).toBe("ERROR_NOTIMP");
		expect(
			required(errors.errors[String(UNKNOWNID)], "0xfe0004")["canonical-name"],
		).toBe("ERROR_UNKNOWNID");
		const failed = required(errors.errors[String(FAILED)], "0xfe0006");
		expect(failed["canonical-name"]).toBe("ERROR_FAILED");
		expect(required(failed.notes, "FAILED notes")).toContain(
			"no user name provided",
		);

		const sys = loadYamlDoc<SysKeysDoc>("profiles/winbox-ipc/sys-keys.yaml");
		const errstr = required(sys.keys[String(0xff0009)], "0xff0009");
		expect(errstr["canonical-name"]).toBe("SYS_ERRSTR");

		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		expect(
			required(gui.handlers["unknown-13-9"], "unknown-13-9").role,
		).toContain("{1:u32 0, 2:u32 0}");
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		for (const name of ALL) {
			const fixture = loadFixture(name);
			// 10 reply legs x 2 + the tx-only [999,1] timeout leg.
			expect(fixture.records.length).toBe(21);
			for (const record of fixture.records) {
				expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
			}
		}
	});

	test("census legs answer the tabled errno + from-route, all versions", () => {
		// [record stem, 7.x errno, 7.x from, v6 errno, v6 from]
		const legs: [string, number, number[], number, number[]][] = [
			["census-get-24-17-bare", BRKPATH, [24], BRKPATH, [24]],
			["census-getobj-20-1-no-rowid", UNKNOWNID, [20, 1], UNKNOWNID, [20, 1]],
			["census-getall-13-9-bare", NOTIMP, [13, 9], BRKPATH, [13]],
			["census-get-13-6-bare", FAILED, [13, 6], FAILED, [13, 6]],
			["census-get-13-7-bare", FAILED, [13, 7], FAILED, [13, 7]],
			["census-getall-13-6-bare", NOTIMP, [13, 6], NOTIMP, [13, 6]],
			["census-getall-13-7-bare", NOTIMP, [13, 7], NOTIMP, [13, 7]],
			["census-getobj-13-6-obj1", NOTIMP, [13, 6], NOTIMP, [13, 6]],
		];
		for (const [stem, errno7, from7, errno6, from6] of legs) {
			for (const name of V7) {
				const rx = decodeFixtureEntries(recordById(name, `${stem}-rx`).hex);
				expect(errnoOf(rx)).toBe(errno7);
				expect(fromOf(rx)).toEqual(from7);
			}
			const v6rx = decodeFixtureEntries(recordById(V6, `${stem}-rx`).hex);
			expect(errnoOf(v6rx)).toBe(errno6);
			expect(fromOf(v6rx)).toEqual(from6);
		}
	});

	test("GETOBJ without row-id carries no 0xfe0001 on the wire", () => {
		for (const name of ALL) {
			const tx = decodeFixtureEntries(
				recordById(name, "census-getobj-20-1-no-rowid-tx").hex,
			);
			expect(requiredEntry(tx, "0xff0007", "SYS_CMD").value).toBe(0xfe0002);
			expect(findEntry(tx, "0xfe0001")).toBeUndefined();
		}
	});

	test("0xff0009 rides ONLY the FAILED legs, verbatim string", () => {
		for (const name of ALL) {
			for (const stem of ["census-get-13-6-bare", "census-get-13-7-bare"]) {
				const record = recordById(name, `${stem}-rx`);
				const rx = decodeFixtureEntries(record.hex);
				const errstr = requiredEntry(rx, "0xff0009", "SYS_ERRSTR");
				expect(errstr.tcode).toBe("0x21");
				expect(errstr.value).toBe("no user name provided");
				// Byte-level, independent of the decoder.
				expect(record.hex).toContain(
					"0900ff21156e6f2075736572206e616d652070726f7669646564",
				);
			}
			// Every other census reply carries no errstr.
			const fixture = loadFixture(name);
			let checked = 0;
			for (const record of fixture.records) {
				if (!record.id.endsWith("-rx")) continue;
				if (
					record.id === "census-get-13-6-bare-rx" ||
					record.id === "census-get-13-7-bare-rx"
				) {
					continue;
				}
				expect(
					findEntry(decodeFixtureEntries(record.hex), "0xff0009"),
				).toBeUndefined();
				checked++;
			}
			expect(checked).toBe(8);
		}
	});

	test("no total rides any census error; statusWord rides errors only", () => {
		for (const name of ALL) {
			const fixture = loadFixture(name);
			let errors = 0;
			let oks = 0;
			for (const record of fixture.records) {
				if (!record.id.endsWith("-rx")) continue;
				const rx = decodeFixtureEntries(record.hex);
				if (findEntry(rx, "0xff0008") !== undefined) {
					errors++;
					expect(findEntry(rx, "0xfe0019")).toBeUndefined();
					expect(findEntry(rx, "0xfe0014")).toBeUndefined();
					expect(findEntry(rx, "0xfe0002")).toBeUndefined();
					expect(requiredEntry(rx, "0xff0004", "SYS_STATUS").value).toBe(2);
				} else {
					oks++;
					expect(findEntry(rx, "0xff0004")).toBeUndefined();
				}
			}
			// v6 answers BRKPATH where 7.x answers ok ([13,9] + [20,125]).
			expect(errors).toBe(name === V6 ? 10 : 8);
			expect(oks).toBe(name === V6 ? 0 : 2);
		}
	});

	test("[13,9] GET arrives on tcode 0x09; [20,125] control reproduces", () => {
		for (const name of V7) {
			const rx = decodeFixtureEntries(
				recordById(name, "census-get-13-9-bare-rx").hex,
			);
			expect(findEntry(rx, "0xff0008")).toBeUndefined();
			const f1 = requiredEntry(rx, "0x000001", "f1");
			const f2 = requiredEntry(rx, "0x000002", "f2");
			expect(f1.tcode).toBe("0x9");
			expect(f1.value).toBe(0);
			expect(f2.tcode).toBe("0x9");
			expect(f2.value).toBe(0);

			const sms = decodeFixtureEntries(
				recordById(name, "census-get-20-125-bare-rx").hex,
			);
			expect(findEntry(sms, "0xff0008")).toBeUndefined();
			expect(sms.length).toBe(17);
		}
		const v6sms = decodeFixtureEntries(
			recordById(V6, "census-get-20-125-bare-rx").hex,
		);
		expect(errnoOf(v6sms)).toBe(BRKPATH);
		expect(fromOf(v6sms)).toEqual([20]);
	});

	test("[999,1] is tx-only and byte-identical across versions", () => {
		const txRecords = ALL.map((name) =>
			recordById(name, "census-get-999-1-unknown-pid-tx"),
		);
		const first = required(txRecords[0], "first [999,1] tx");
		const second = required(txRecords[1], "second [999,1] tx");
		const third = required(txRecords[2], "third [999,1] tx");
		expect(first.hex).toBe(second.hex);
		expect(first.hex).toBe(third.hex);
		const tx = decodeFixtureEntries(first.hex);
		expect(requiredEntry(tx, "0xff0001", "SYS_TO").value).toEqual([999, 1]);
		for (const name of ALL) {
			const fixture = loadFixture(name);
			expect(
				fixture.records.some((r) => r.id === "census-get-999-1-unknown-pid-rx"),
			).toBe(false);
		}
	});
});
