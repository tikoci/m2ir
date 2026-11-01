// [20,125] /tool/sms map-completion + verb census replay (queue-3 item 4).
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (sms-20-125 field map, set scope,
// and notes) and profiles/winbox-ipc/std-commands.yaml (CMD_SET,
// CMD_GETALL, CMD_GETOBJ, CMD_GETCOUNT names). The wire bytes live in
// fixtures/winbox-ipc/{7.25,7.26beta4}-set-20-125-map.json, sanitized from
// the queue-3 mutation capture batch (live CHR interrogation; every SET
// claim carries native GET read-back and independent REST /tool/sms reads
// — the control reads are described in the schema notes, not replayed
// here).
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

interface CommandsDoc {
	commands: Record<string, { "canonical-name"?: string }>;
}

interface ErrorsDoc {
	errors: Record<string, { "canonical-name"?: string }>;
}

interface HandlersDoc {
	handlers: Record<
		string,
		{
			fields?: {
				"namespace-user"?: Record<string, { name?: string; access?: string }>;
			};
		}
	>;
}

const VERSIONS = ["7.25", "7.26beta4"] as const;

function mapName(version: (typeof VERSIONS)[number]): string {
	return `${version}-set-20-125-map.json`;
}

function commandName(cmd: number): string {
	const doc = loadYamlDoc<CommandsDoc>("profiles/winbox-ipc/std-commands.yaml");
	return required(
		doc.commands[String(cmd)]?.["canonical-name"],
		`commands[${cmd}]`,
	);
}

function errnoName(errno: number): string {
	const doc = loadYamlDoc<ErrorsDoc>("profiles/winbox-ipc/std-errors.yaml");
	return required(
		doc.errors[String(errno)]?.["canonical-name"],
		`errors[${errno}]`,
	);
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

function fieldAttr(field: string, attr: "name" | "access"): string | undefined {
	const doc = loadYamlDoc<HandlersDoc>("profiles/winbox-ipc/gui-handlers.yaml");
	return doc.handlers["sms-20-125"]?.fields?.["namespace-user"]?.[field]?.[
		attr
	];
}

// Proxy-banner TLV hex on each version (the only cross-version rx delta).
const BANNER_TLV: Record<(typeof VERSIONS)[number], string> = {
	"7.25": "1c00ffa001000e006d73672d70726f78792d372e3235",
	"7.26beta4": "1c00ffa0010013006d73672d70726f78792d372e32366265746134",
};

describe("sms [20,125] map-completion replay", () => {
	test("schema binds the sms field map, access, and verb names", () => {
		const names: Array<[string, string]> = [
			["7", "receive-enabled"],
			["9", "secret"],
			["12", "channel"],
			["13", "sim-pin"],
			["14", "port-ref"],
			["16", "port-absent"],
			["17", "allowed-number"],
			["21", "sms-storage"],
			["23", "polling"],
			["24", "remove-sent-sms-after-send"],
			["100", "unknown-100"],
			["101", "unknown-101"],
		];
		for (const [field, name] of names) {
			expect(fieldAttr(field, "name")).toBe(name);
		}
		for (const field of ["7", "9", "12", "13", "14", "17", "21", "23", "24"]) {
			expect(fieldAttr(field, "access")).toBe("read-write");
		}
		for (const field of ["16", "100", "101"]) {
			expect(fieldAttr(field, "access")).toBe("read-only");
		}
		expect(commandName(0xfe000e)).toBe("CMD_SET");
		expect(commandName(0xfe0004)).toBe("CMD_GETALL");
		expect(commandName(0xfe0002)).toBe("CMD_GETOBJ");
		expect(commandName(0xfe0015)).toBe("CMD_GETCOUNT");
		expect(errnoName(0xfe0004)).toBe("ERROR_UNKNOWNID");
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		for (const version of VERSIONS) {
			const fixture = loadFixture(mapName(version));
			expect(fixture.records.length).toBe(72);
			for (const record of fixture.records) {
				expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
			}
		}
	});

	test("verb census: GETALL ok total-0, GETOBJ UNKNOWNID, GETCOUNT ok 0", () => {
		const replyLen: Record<(typeof VERSIONS)[number], number> = {
			"7.25": 67,
			"7.26beta4": 72,
		};
		const objLen: Record<(typeof VERSIONS)[number], number> = {
			"7.25": 75,
			"7.26beta4": 80,
		};
		for (const version of VERSIONS) {
			const fixture = loadFixture(mapName(version));
			const byId = new Map(fixture.records.map((r) => [r.id, r]));
			const decode = (id: string) =>
				decodeFixtureEntries(required(byId.get(id), id).hex);

			// Singleton GETALL: ok with total 0 and no rows array.
			const getall = decode("verb-getall-20-125-bare-rx");
			expect(
				required(byId.get("verb-getall-20-125-bare-rx"), "rx").hex.length / 2,
			).toBe(replyLen[version]);
			expect(findEntry(getall, "0xff0008")).toBeUndefined();
			expect(findEntry(getall, "0xff0004")).toBeUndefined();
			expect(requiredEntry(getall, "0xfe0019", "TOTAL").value).toBe(0);
			expect(findEntry(getall, "0xfe0002")).toBeUndefined();

			// Singleton GETOBJ: verb-level UNKNOWNID from the full route.
			const getobjTx = required(byId.get("verb-getobj-20-125-obj-1-tx"), "tx");
			expect(getobjTx.cmd).toBe(0xfe0002);
			const getobj = decode("verb-getobj-20-125-obj-1-rx");
			expect(
				required(byId.get("verb-getobj-20-125-obj-1-rx"), "rx").hex.length / 2,
			).toBe(objLen[version]);
			expect(requiredEntry(getobj, "0xff0008", "ERRNO").value).toBe(0xfe0004);
			expect(
				required(byId.get("verb-getobj-20-125-obj-1-rx"), "rx").from,
			).toEqual([20, 125]);

			// GETCOUNT: ok + 0 in the 7.x slot, no statusWord.
			const getcount = decode("verb-getcount-20-125-bare-rx");
			expect(findEntry(getcount, "0xff0008")).toBeUndefined();
			expect(findEntry(getcount, "0xff0004")).toBeUndefined();
			expect(requiredEntry(getcount, "0xfe0019", "TOTAL").value).toBe(0);
		}
	});

	test("took-and-restored fields move exactly one field both ways", () => {
		const probes: Array<{
			id: string;
			key: string;
			value: unknown;
		}> = [
			{ id: "map-polling", key: "0x000017", value: true },
			{ id: "map-remove-sent-sms-after-send", key: "0x000018", value: true },
			{ id: "map-secret", key: "0x000009", value: "q4secret" },
			{ id: "map-sim-pin", key: "0x00000d", value: "1357" },
			{ id: "map-allowed-number", key: "0x000011", value: ["+15550001111"] },
		];
		for (const version of VERSIONS) {
			const fixture = loadFixture(mapName(version));
			const byId = new Map(fixture.records.map((r) => [r.id, r]));
			const decode = (id: string) =>
				decodeFixtureEntries(required(byId.get(id), id).hex);
			const anchor = userMap(decode("baseline-get-20-125-1-rx"));

			for (const probe of probes) {
				// Singleton SET carries exactly the one USER field under test.
				const txUser = userEntries(decode(`set-${probe.id}-tx`));
				expect(txUser.map((e) => e.key)).toEqual([probe.key]);
				expect(txUser[0]?.value).toEqual(probe.value);

				// The read-back moves only that field vs the anchor.
				expect(
					changedKeys(
						decode("baseline-get-20-125-1-rx"),
						decode(`get-after-${probe.id}-rx`),
					),
				).toEqual([probe.key, "0xff0006"].sort());
				expect(
					requiredEntry(decode(`get-after-${probe.id}-rx`), probe.key, "probe")
						.value,
				).toEqual(probe.value);

				// Restore + leg-final equal the anchor on USER state.
				expect(userMap(decode(`get-after-${probe.id}-restore-rx`))).toEqual(
					anchor,
				);
			}
			expect(userMap(decode("leg1-final-get-rx"))).toEqual(anchor);
		}
	});

	test("0x64/0x65/0x10 are read-only: SET ignored with zero move", () => {
		for (const version of VERSIONS) {
			const fixture = loadFixture(mapName(version));
			const byId = new Map(fixture.records.map((r) => [r.id, r]));
			const decode = (id: string) =>
				decodeFixtureEntries(required(byId.get(id), id).hex);
			const anchor = userMap(decode("baseline-get-20-125-1-rx"));

			expect(userEntries(decode("set-map-unknown-f100-tx"))).toEqual([
				{ key: "0x000064", tcode: "0x1", value: true },
			]);
			expect(userEntries(decode("set-map-unknown-f101-tx"))).toEqual([
				{ key: "0x000065", tcode: "0x21", value: "q4status" },
			]);
			expect(userEntries(decode("set-map-port-absent-tx"))).toEqual([
				{ key: "0x000010", tcode: "0x0", value: false },
			]);

			// Ok-shaped replies, zero USER state change vs the anchor.
			for (const probe of [
				"map-unknown-f100",
				"map-unknown-f101",
				"map-port-absent",
			]) {
				const ack = decode(`set-${probe}-ack`);
				expect(userEntries(ack)).toEqual([]);
				expect(findEntry(ack, "0xff0008")).toBeUndefined();
				expect(userMap(decode(`get-after-${probe}-rx`))).toEqual(anchor);
			}
		}
	});

	test("0x0e is a writable port reference; the triple does not recompute", () => {
		for (const version of VERSIONS) {
			const fixture = loadFixture(mapName(version));
			const byId = new Map(fixture.records.map((r) => [r.id, r]));
			const decode = (id: string) =>
				decodeFixtureEntries(required(byId.get(id), id).hex);
			const anchor = userMap(decode("baseline-get-20-125-1-rx"));

			// Anchor: 0x0e = max (the none sentinel), 0x10 = T, 0x04 absent.
			const anchorFull = decode("baseline-get-20-125-1-rx");
			expect(requiredEntry(anchorFull, "0x00000e", "0x0e").value).toBe(
				0xffffffff,
			);
			expect(requiredEntry(anchorFull, "0x000010", "0x10").value).toBe(true);
			expect(findEntry(anchorFull, "0x000004")).toBeUndefined();

			// SET 0x0e=0 moves ONLY 0x0e: 0x10 stays T, 0x04 stays absent.
			expect(userEntries(decode("set-map-unknown-f14-tx"))).toEqual([
				{ key: "0x00000e", tcode: "0x9", value: 0 },
			]);
			const moved = decode("get-after-map-unknown-f14-rx");
			expect(changedKeys(decode("baseline-get-20-125-1-rx"), moved)).toEqual(
				["0x00000e", "0xff0006"].sort(),
			);
			expect(requiredEntry(moved, "0x00000e", "0x0e").value).toBe(0);
			expect(requiredEntry(moved, "0x000010", "0x10").value).toBe(true);
			expect(findEntry(moved, "0x000004")).toBeUndefined();

			// Restore to max returns the anchor.
			expect(userEntries(decode("map-unknown-f14-restore-tx"))).toEqual([
				{ key: "0x00000e", tcode: "0x8", value: 0xffffffff },
			]);
			expect(userMap(decode("get-after-map-unknown-f14-restore-rx"))).toEqual(
				anchor,
			);
		}
	});

	test("f04 is absent from every GET reply on both versions", () => {
		for (const version of VERSIONS) {
			const fixture = loadFixture(mapName(version));
			let checked = 0;
			for (const record of fixture.records) {
				if (!record.id.endsWith("-rx")) continue;
				const entries = decodeFixtureEntries(record.hex);
				expect(findEntry(entries, "0x000004")).toBeUndefined();
				checked++;
			}
			// 18 GET read-backs + 3 verb replies per fixture.
			expect(checked).toBe(21);
		}
	});

	test("every SET ack is bare SYS-only on both versions", () => {
		for (const version of VERSIONS) {
			const fixture = loadFixture(mapName(version));
			let ackCount = 0;
			for (const record of fixture.records) {
				if (!record.id.endsWith("-ack")) continue;
				const entries = decodeFixtureEntries(record.hex);
				expect(userEntries(entries)).toEqual([]);
				expect(findEntry(entries, "0xff0008")).toBeUndefined();
				expect(findEntry(entries, "0xff0004")).toBeUndefined();
				expect(
					requiredEntry(entries, "0xff0003", `${record.id} TYPE`).value,
				).toBe(2);
				ackCount++;
			}
			expect(ackCount).toBe(15);
		}
	});

	test("twin3 and beta4 agree modulo the proxy banner", () => {
		const a = loadFixture(mapName("7.25"));
		const b = loadFixture(mapName("7.26beta4"));
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
	});
});
