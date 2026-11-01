// [20,125] /tool/sms silent-ignore + f12 + v6-absence replay (queue-2).
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (sms-20-125 notes),
// profiles/winbox-ipc/std-errors.yaml (ERROR_BRKPATH sample evidence;
// ERROR_FAILED name binding only — FAILED was never provoked here), and
// profiles/winbox-ipc/sys-keys.yaml (SYS_STATUS/SYS_ERRNO names). The wire
// bytes live in
// fixtures/winbox-ipc/{7.25,7.26beta4}-set-20-125-sms-negative.json and
// fixtures/winbox-ipc/6.49-set-20-125-sms-absent.json, sanitized from the
// queue-2 mutation capture batch (live CHR interrogation; independent
// REST /tool/sms tracked the f12 accept/restore — the control reads are
// described in the schema notes, not replayed here).
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

function negativeName(version: (typeof VERSIONS)[number]): string {
	return `${version}-set-20-125-sms-negative.json`;
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

function userMap(entries: FixtureEntry[]): Array<[string, string]> {
	return userEntries(entries).map(
		(e) => [e.key, JSON.stringify(e.value)] as [string, string],
	);
}

describe("sms [20,125] silent-ignore and absence replay", () => {
	test("schema binds the BRKPATH evidence and the open FAILED name", () => {
		expect(errnoName(0xfe0002)).toBe("ERROR_BRKPATH");
		// FAILED was never provoked on [20,125]: YAML name only, no sample.
		expect(errnoName(0xfe0006)).toBe("ERROR_FAILED");
		expect(statusValue("ERROR")).toBe(2);
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		for (const version of VERSIONS) {
			const fixture = loadFixture(negativeName(version));
			expect(fixture.records.length).toBe(26);
			for (const record of fixture.records) {
				expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
			}
		}
		const absent = loadFixture("6.49-set-20-125-sms-absent.json");
		expect(absent.records.length).toBe(6);
		for (const record of absent.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("silent-ignore probes answer ok with zero state change", () => {
		for (const version of VERSIONS) {
			const fixture = loadFixture(negativeName(version));
			const byId = new Map(fixture.records.map((r) => [r.id, r]));
			const decode = (id: string) =>
				decodeFixtureEntries(required(byId.get(id), id).hex);
			const anchor = userMap(decode("anchor-get-rx"));

			// Probe shapes on the wire: wrong-tcode f07, unknown f999, empty.
			expect(userEntries(decode("probe-a-tx"))).toEqual([
				{ key: "0x000007", tcode: "0x9", value: 1 },
			]);
			expect(userEntries(decode("probe-b-tx"))).toEqual([
				{ key: "0x0003e7", tcode: "0x9", value: 1 },
			]);
			expect(userEntries(decode("probe-d-tx"))).toEqual([]);

			// Every probe ack is ok-shaped: bare SYS-only, no errno.
			for (const id of ["probe-a-ack", "probe-b-ack", "probe-d-ack"]) {
				const entries = decode(id);
				expect(userEntries(entries)).toEqual([]);
				expect(findEntry(entries, "0xff0008")).toBeUndefined();
				expect(requiredEntry(entries, "0xff0003", `${id} TYPE`).value).toBe(2);
			}

			// Zero USER state change vs the anchor after each ignored probe.
			for (const id of [
				"probe-a-read-back-rx",
				"probe-b-read-back-rx",
				"probe-d-read-back-rx",
			]) {
				expect(userMap(decode(id))).toEqual(anchor);
			}
		}
	});

	test("f12 accepts 99 and restores to 0 with only f12 moving", () => {
		for (const version of VERSIONS) {
			const fixture = loadFixture(negativeName(version));
			const byId = new Map(fixture.records.map((r) => [r.id, r]));
			const decode = (id: string) =>
				decodeFixtureEntries(required(byId.get(id), id).hex);

			expect(userEntries(decode("probe-c-tx"))).toEqual([
				{ key: "0x00000c", tcode: "0x9", value: 99 },
			]);
			expect(
				requiredEntry(decode("probe-c-read-back-rx"), "0x00000c", "f12").value,
			).toBe(99);
			expect(
				changedKeys(
					decode("pre-channel-get-rx"),
					decode("probe-c-read-back-rx"),
				),
			).toEqual(["0x00000c", "0xff0006"]);

			expect(userEntries(decode("f12-restore-tx"))).toEqual([
				{ key: "0x00000c", tcode: "0x9", value: 0 },
			]);
			// Restore + final equal the anchor (USER state; reqid echo aside).
			const anchor = userMap(decode("anchor-get-rx"));
			expect(userMap(decode("f12-restore-read-back-rx"))).toEqual(anchor);
			expect(userMap(decode("final-get-rx"))).toEqual(anchor);
		}
	});

	test("allowed-number 0x11 stays [] across every 7.x GET reply", () => {
		const names = [
			"7.25-set-20-125-sms.json",
			"7.26beta4-set-20-125-sms.json",
			...VERSIONS.map(negativeName),
		];
		let checked = 0;
		for (const name of names) {
			const fixture = loadFixture(name);
			for (const record of fixture.records) {
				if (!record.id.endsWith("-rx") || record.id.endsWith("-ack")) continue;
				const entries = decodeFixtureEntries(record.hex);
				expect(
					requiredEntry(entries, "0x000011", `${name} ${record.id}`).value,
				).toEqual([]);
				checked++;
			}
		}
		// 4 toggle GET replies x2 versions + 8 negative GET replies x2 versions.
		expect(checked).toBe(24);
	});

	test("v6 absence is ERROR_BRKPATH from=[20] with null errstr", () => {
		const error = statusValue("ERROR");
		const fixture = loadFixture("6.49-set-20-125-sms-absent.json");
		const rxIds = [
			"baseline-get1-rx",
			"baseline-get2-rx",
			"absence-probe-set-rx",
		];
		expect(fixture.records.map((r) => r.id)).toEqual([
			"baseline-get1-tx",
			"baseline-get1-rx",
			"baseline-get2-tx",
			"baseline-get2-rx",
			"absence-probe-set-tx",
			"absence-probe-set-rx",
		]);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		for (const id of rxIds) {
			const record = required(byId.get(id), id) as FixtureRecord;
			const entries = decodeFixtureEntries(record.hex);
			expect(requiredEntry(entries, "0xff0004", `${id} STATUS`).value).toBe(
				error,
			);
			expect(requiredEntry(entries, "0xff0008", `${id} ERRNO`).value).toBe(
				0xfe0002,
			);
			expect(errnoName(0xfe0002)).toBe("ERROR_BRKPATH");
			expect(record.from).toEqual([20]);
			// errstr null: the SYS_ERRSTR key is absent from the envelope.
			expect(findEntry(entries, "0xff0009")).toBeUndefined();
			expect(record.reqId).not.toBeNull();
		}
		// The probe SET went out as a normal singleton SET (router answered).
		const probeTx = required(byId.get("absence-probe-set-tx"), "probe tx");
		expect(probeTx.cmd).toBe(0xfe000e);
		expect(probeTx.to).toEqual([20, 125]);
	});

	test("ERROR_FAILED never appears as an errno in queue-2 bytes", () => {
		const names = [
			"7.25-set-20-125-sms.json",
			"7.26beta4-set-20-125-sms.json",
			...VERSIONS.map(negativeName),
			"6.49-set-20-125-sms-absent.json",
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
		expect(records).toBe(82);
	});
});
