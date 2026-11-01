// [20,125] /tool/sms ERROR_FAILED candidacy + v6 5-verb replay (queue-3 item 4).
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (sms-20-125 0x15/oversize notes +
// the still-open ERROR_FAILED paragraph) and
// profiles/winbox-ipc/std-errors.yaml (ERROR_FAILED name binding — FAILED
// was never provoked here — plus the ERROR_BRKPATH v6 sample). The wire
// bytes live in
// fixtures/winbox-ipc/{7.25,7.26beta4}-set-20-125-error-failed.json and
// fixtures/winbox-ipc/6.49-verbs-20-125-absent.json, sanitized from the
// queue-3 mutation capture batch (live CHR interrogation; every SET claim
// carries native GET read-back and independent REST /tool/sms reads — the
// control reads are described in the schema notes, not replayed here).
//
// Rule: expected names come from the YAML, never from hardcoded labels. The
// mini parser (./m2-replay.ts) is independent of the work/ harness decoder.

import { describe, expect, test } from "bun:test";
import {
	decodeFixtureEntries,
	type FixtureEntry,
	type FixtureRecord,
	findEntry,
	loadFixture,
	loadYamlDoc,
	required,
	requiredEntry,
} from "./m2-replay";

interface ErrorsDoc {
	errors: Record<string, { "canonical-name"?: string }>;
}

interface SysKeysDoc {
	keys: Record<
		string,
		{ "canonical-name"?: string; values?: Record<string, string> }
	>;
}

const VERSIONS = ["7.25", "7.26beta4"] as const;

function failedName(version: (typeof VERSIONS)[number]): string {
	return `${version}-set-20-125-error-failed.json`;
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

/** USER-namespace (0x00) entries only: SYS/STD envelope keys excluded. */
function userEntries(entries: FixtureEntry[]): FixtureEntry[] {
	return entries.filter((e) => e.key.startsWith("0x00"));
}

/** Keys whose value differs between two decoded replies. */
function changedKeys(before: FixtureEntry[], after: FixtureEntry[]): string[] {
	const beforeByKey = new Map(before.map((e) => [e.key, e.value]));
	const afterByKey = new Map(after.map((e) => [e.key, e.value]));
	const changed: string[] = [];
	for (const key of new Set([...beforeByKey.keys(), ...afterByKey.keys()])) {
		if (
			JSON.stringify(beforeByKey.get(key)) !==
			JSON.stringify(afterByKey.get(key))
		) {
			changed.push(key);
		}
	}
	return changed.sort();
}

function userMap(entries: FixtureEntry[]): Array<[string, string]> {
	return userEntries(entries).map(
		(e) => [e.key, JSON.stringify(e.value)] as [string, string],
	);
}

// Proxy-banner TLV hex on each version (the only cross-version rx delta).
const BANNER_TLV: Record<(typeof VERSIONS)[number], string> = {
	"7.25": "1c00ffa001000e006d73672d70726f78792d372e3235",
	"7.26beta4": "1c00ffa0010013006d73672d70726f78792d372e32366265746134",
};

describe("sms [20,125] ERROR_FAILED candidacy replay", () => {
	test("schema binds the open FAILED name and the BRKPATH evidence", () => {
		// FAILED was never provoked on [20,125]: YAML name only, no sample.
		expect(errnoName(0xfe0006)).toBe("ERROR_FAILED");
		expect(errnoName(0xfe0002)).toBe("ERROR_BRKPATH");
		expect(statusValue("ERROR")).toBe(2);
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		for (const version of VERSIONS) {
			const fixture = loadFixture(failedName(version));
			expect(fixture.records.length).toBe(68);
			for (const record of fixture.records) {
				expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
			}
		}
		const absent = loadFixture("6.49-verbs-20-125-absent.json");
		expect(absent.records.length).toBe(10);
		for (const record of absent.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("confusion probes are ignored with zero state change", () => {
		const probes: Array<{ id: string; entry: FixtureEntry }> = [
			{
				id: "e1-f09-as-u32",
				entry: { key: "0x000009", tcode: "0x9", value: 1 },
			},
			{
				id: "e2-f13-as-u32",
				entry: { key: "0x00000d", tcode: "0x9", value: 1 },
			},
			{
				id: "e3-f07-as-str",
				entry: { key: "0x000007", tcode: "0x21", value: "yes" },
			},
			{
				id: "e4-f12-as-str",
				entry: { key: "0x00000c", tcode: "0x21", value: "99" },
			},
			{
				id: "e10-f11-as-u32",
				entry: { key: "0x000011", tcode: "0x9", value: 1 },
			},
			{
				id: "e11-f11-as-str",
				entry: { key: "0x000011", tcode: "0x21", value: "+15550001111" },
			},
		];
		for (const version of VERSIONS) {
			const fixture = loadFixture(failedName(version));
			const byId = new Map(fixture.records.map((r) => [r.id, r]));
			const decode = (id: string) =>
				decodeFixtureEntries(required(byId.get(id), id).hex);
			const anchor = userMap(decode("leg3-anchor-get-rx"));

			for (const probe of probes) {
				expect(userEntries(decode(`set-${probe.id}-tx`))).toEqual([
					probe.entry,
				]);
				const ack = decode(`set-${probe.id}-ack`);
				expect(userEntries(ack)).toEqual([]);
				expect(findEntry(ack, "0xff0008")).toBeUndefined();
				expect(userMap(decode(`get-after-${probe.id}-rx`))).toEqual(anchor);
			}
		}
	});

	test("oversize 4096-char string stores verbatim and restores", () => {
		const rxLen: Record<(typeof VERSIONS)[number], number> = {
			"7.25": 4218,
			"7.26beta4": 4223,
		};
		for (const version of VERSIONS) {
			const fixture = loadFixture(failedName(version));
			const byId = new Map(fixture.records.map((r) => [r.id, r]));
			const decode = (id: string) =>
				decodeFixtureEntries(required(byId.get(id), id).hex);
			const anchor = userMap(decode("leg3-anchor-get-rx"));

			// 4149B SET: tcode 0x20 with a u16 length of 0x1000, all S body.
			const tx = required(byId.get("set-e5-f09-oversize-4k-tx"), "tx");
			expect(tx.hex.length / 2).toBe(4149);
			expect(tx.hex).toContain("090000200010");
			expect(
				requiredEntry(decode("set-e5-f09-oversize-4k-tx"), "0x000009", "f09")
					.value,
			).toBe("S".repeat(4096));

			// Read-back stores the same 4096 S characters, then restores.
			const back = decode("get-after-e5-f09-oversize-4k-rx");
			expect(
				required(byId.get("get-after-e5-f09-oversize-4k-rx"), "rx").hex.length /
					2,
			).toBe(rxLen[version]);
			expect(requiredEntry(back, "0x000009", "f09")).toEqual({
				key: "0x000009",
				tcode: "0x20",
				value: "S".repeat(4096),
			});
			expect(changedKeys(decode("leg3-anchor-get-rx"), back)).toEqual(
				["0x000009", "0xff0006"].sort(),
			);
			expect(
				userMap(decode("get-after-e5-f09-oversize-4k-restore-rx")),
			).toEqual(anchor);
		}
	});

	test("0x15 accepts any u32 and restores with only 0x15 moving", () => {
		for (const version of VERSIONS) {
			const fixture = loadFixture(failedName(version));
			const byId = new Map(fixture.records.map((r) => [r.id, r]));
			const decode = (id: string) =>
				decodeFixtureEntries(required(byId.get(id), id).hex);
			const anchor = userMap(decode("leg3-anchor-get-rx"));
			expect(
				requiredEntry(decode("leg3-anchor-get-rx"), "0x000015", "0x15").value,
			).toBe(1);

			for (const [tag, value] of [
				["e6-f15-enum-0", 0],
				["e7-f15-enum-2", 2],
				["e8-f15-enum-99", 99],
				["e9-f15-enum-max", 0xffffffff],
			] as Array<[string, number]>) {
				expect(
					requiredEntry(decode(`get-after-${tag}-rx`), "0x000015", "0x15")
						.value,
				).toBe(value);
				expect(
					changedKeys(
						decode("leg3-anchor-get-rx"),
						decode(`get-after-${tag}-rx`),
					),
				).toEqual(["0x000015", "0xff0006"].sort());
				expect(userMap(decode(`get-after-${tag}-restore-rx`))).toEqual(anchor);
			}
			expect(userMap(decode("leg3-final-get-rx"))).toEqual(anchor);
		}
	});

	test("v6 answers all 5 verbs BRKPATH from=[20] with null errstr", () => {
		const error = statusValue("ERROR");
		const fixture = loadFixture("6.49-verbs-20-125-absent.json");
		expect(fixture.records.map((r) => r.id)).toEqual([
			"baseline-get-20-125-1-tx",
			"baseline-get-20-125-1-rx",
			"baseline-get-20-125-2-tx",
			"baseline-get-20-125-2-rx",
			"v6-getall-20-125-tx",
			"v6-getall-20-125-rx",
			"v6-getobj-obj-1-tx",
			"v6-getobj-obj-1-rx",
			"v6-getcount-tx",
			"v6-getcount-rx",
		]);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		// The census covers GET x2 + GETALL + GETOBJ + GETCOUNT; zero SET.
		expect(
			fixture.records.filter((r) => r.id.endsWith("-tx")).map((r) => r.cmd),
		).toEqual([0xfe000d, 0xfe000d, 0xfe0004, 0xfe0002, 0xfe0015]);
		for (const record of fixture.records) {
			expect(record.cmd).not.toBe(0xfe000e);
			if (record.id.endsWith("-tx")) {
				expect(record.to).toEqual([20, 125]);
			}
		}
		for (const id of [
			"baseline-get-20-125-1-rx",
			"baseline-get-20-125-2-rx",
			"v6-getall-20-125-rx",
			"v6-getobj-obj-1-rx",
			"v6-getcount-rx",
		]) {
			const record = required(byId.get(id), id) as FixtureRecord;
			expect(record.hex.length / 2).toBe(49);
			const entries = decodeFixtureEntries(record.hex);
			expect(requiredEntry(entries, "0xff0004", `${id} STATUS`).value).toBe(
				error,
			);
			expect(requiredEntry(entries, "0xff0008", `${id} ERRNO`).value).toBe(
				0xfe0002,
			);
			expect(record.from).toEqual([20]);
			// errstr null: the SYS_ERRSTR key is absent from the envelope.
			expect(findEntry(entries, "0xff0009")).toBeUndefined();
			// v6 carries no proxy-banner key at all.
			expect(findEntry(entries, "0xff001c")).toBeUndefined();
			expect(record.reqId).not.toBeNull();
		}
	});

	test("ERROR_FAILED never appears as an errno in item-4 bytes", () => {
		const names = [
			"7.25-set-20-125-map.json",
			"7.26beta4-set-20-125-map.json",
			"7.25-set-20-125-f12-range.json",
			"7.26beta4-set-20-125-f12-range.json",
			"7.25-set-20-125-error-failed.json",
			"7.26beta4-set-20-125-error-failed.json",
			"6.49-verbs-20-125-absent.json",
		];
		let records = 0;
		for (const name of names) {
			const fixture = loadFixture(name);
			for (const record of fixture.records) {
				records++;
				for (const entry of decodeFixtureEntries(record.hex)) {
					if (entry.key === "0xff0008") {
						expect(entry.value).not.toBe(0xfe0006);
					}
				}
			}
		}
		expect(records).toBe(378);
	});

	test("no drift on this leg; no async strays in any item-4 fixture", () => {
		const a = loadFixture(failedName("7.25"));
		const b = loadFixture(failedName("7.26beta4"));
		expect(a.records.map((r) => r.id)).toEqual(b.records.map((r) => r.id));
		for (let i = 0; i < a.records.length; i++) {
			const ra = required(a.records[i], `7.25[${i}]`);
			const rb = required(b.records[i], `7.26beta4[${i}]`);
			if (ra.id.endsWith("-tx")) {
				expect(rb.hex).toBe(ra.hex);
			} else {
				expect(rb.hex.split(BANNER_TLV["7.26beta4"]).join("BANNER")).toBe(
					ra.hex.split(BANNER_TLV["7.25"]).join("BANNER"),
				);
			}
		}
		// None observed: every reply/ack carries a request id (no async).
		const names = [
			"7.25-set-20-125-map.json",
			"7.26beta4-set-20-125-map.json",
			"7.25-set-20-125-f12-range.json",
			"7.26beta4-set-20-125-f12-range.json",
			"7.25-set-20-125-error-failed.json",
			"7.26beta4-set-20-125-error-failed.json",
			"6.49-verbs-20-125-absent.json",
		];
		let replies = 0;
		for (const name of names) {
			const fixture = loadFixture(name);
			for (const record of fixture.records) {
				if (record.id.endsWith("-tx")) continue;
				expect(record.reqId).not.toBeNull();
				replies++;
			}
		}
		expect(replies).toBe(189);
	});
});
