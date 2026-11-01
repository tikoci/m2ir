// [20,125] /tool/sms f12 full-range replay (queue-3 item 4).
//
// The schema entry under test is sms-20-125 in
// profiles/winbox-ipc/gui-handlers.yaml (channel field role + notes). The
// wire bytes live in
// fixtures/winbox-ipc/{7.25,7.26beta4}-set-20-125-f12-range.json, sanitized
// from the queue-3 mutation capture batch (live CHR interrogation; every
// SET claim carries native GET read-back and independent REST /tool/sms
// channel reads — the control reads are described in the schema notes, not
// replayed here).
//
// Rule: expected names come from the YAML, never from hardcoded labels. The
// mini parser (./m2-replay.ts) is independent of the work/ harness decoder.

import { describe, expect, test } from "bun:test";
import {
	decodeFixtureEntries,
	type FixtureEntry,
	findEntry,
	loadFixture,
	required,
	requiredEntry,
} from "./m2-replay";

const VERSIONS = ["7.25", "7.26beta4"] as const;

function rangeName(version: (typeof VERSIONS)[number]): string {
	return `${version}-set-20-125-f12-range.json`;
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

describe("sms [20,125] f12 full-range replay", () => {
	test("fixture hex re-decodes to the recorded entries offline", () => {
		for (const version of VERSIONS) {
			const fixture = loadFixture(rangeName(version));
			expect(fixture.records.length).toBe(44);
			for (const record of fixture.records) {
				expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
			}
		}
	});

	test("1/255/256/65535/max each take and restore with only f12 moving", () => {
		const values = [1, 255, 256, 65535, 0xffffffff];
		for (const version of VERSIONS) {
			const fixture = loadFixture(rangeName(version));
			const byId = new Map(fixture.records.map((r) => [r.id, r]));
			const decode = (id: string) =>
				decodeFixtureEntries(required(byId.get(id), id).hex);
			const anchor = userMap(decode("leg2-anchor-get-rx"));
			expect(
				requiredEntry(decode("leg2-anchor-get-rx"), "0x00000c", "f12").value,
			).toBe(0);

			for (const value of values) {
				const tag = `f12-${value}`;
				expect(userEntries(decode(`set-${tag}-tx`)).map((e) => e.key)).toEqual([
					"0x00000c",
				]);
				expect(
					requiredEntry(decode(`get-after-${tag}-rx`), "0x00000c", "f12").value,
				).toBe(value);
				expect(
					changedKeys(
						decode("leg2-anchor-get-rx"),
						decode(`get-after-${tag}-rx`),
					),
				).toEqual(["0x00000c", "0xff0006"].sort());
				expect(userMap(decode(`get-after-${tag}-restore-rx`))).toEqual(anchor);
			}
			expect(userMap(decode("leg2-final-get-rx"))).toEqual(anchor);
		}
	});

	test("compact/wide tcode crossover at 255/256 on the wire", () => {
		for (const version of VERSIONS) {
			const fixture = loadFixture(rangeName(version));
			const byId = new Map(fixture.records.map((r) => [r.id, r]));
			const decode = (id: string) =>
				decodeFixtureEntries(required(byId.get(id), id).hex);

			// 255 stays compact 0x09 (single byte 0xff); 256+ go wide 0x08.
			expect(
				requiredEntry(decode("set-f12-255-tx"), "0x00000c", "f12"),
			).toEqual({
				key: "0x00000c",
				tcode: "0x9",
				value: 255,
			});
			expect(
				required(byId.get("set-f12-255-tx"), "tx").hex.endsWith("0c000009ff"),
			).toBe(true);
			expect(
				requiredEntry(decode("set-f12-256-tx"), "0x00000c", "f12"),
			).toEqual({
				key: "0x00000c",
				tcode: "0x8",
				value: 256,
			});
			expect(
				required(byId.get("set-f12-256-tx"), "tx").hex.endsWith(
					"0c00000800010000",
				),
			).toBe(true);
			// The router echoes the same tcode family in its read-backs.
			expect(
				requiredEntry(decode("get-after-f12-255-rx"), "0x00000c", "f12").tcode,
			).toBe("0x9");
			expect(
				requiredEntry(decode("get-after-f12-256-rx"), "0x00000c", "f12").tcode,
			).toBe("0x8");
			expect(
				requiredEntry(decode("get-after-f12-4294967295-rx"), "0x00000c", "f12"),
			).toEqual({ key: "0x00000c", tcode: "0x8", value: 0xffffffff });
		}
	});

	test("ack replies are bare SYS-only; twin3 and beta4 agree modulo the banner", () => {
		for (const version of VERSIONS) {
			const fixture = loadFixture(rangeName(version));
			let ackCount = 0;
			for (const record of fixture.records) {
				if (!record.id.endsWith("-ack")) continue;
				const entries = decodeFixtureEntries(record.hex);
				expect(userEntries(entries)).toEqual([]);
				expect(findEntry(entries, "0xff0008")).toBeUndefined();
				expect(findEntry(entries, "0xff0004")).toBeUndefined();
				ackCount++;
			}
			expect(ackCount).toBe(10);
		}
		const a = loadFixture(rangeName("7.25"));
		const b = loadFixture(rangeName("7.26beta4"));
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
