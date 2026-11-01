// Source-id adoption reply replay (6.49.23 + 7.25 + 7.26beta4).
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (source-id-adoption response +
// reply-values: wire identity + version scope only). The wire bytes live in
// fixtures/winbox-ipc/{6.49,7.25,7.26beta4}-adopt-13-4-rx.json, sanitized
// from the queue-1 r-a manifests — the first full adoption-reply dumps
// (the committed adoption-13-4-tx.json fixture was tx-only).
//
// v7 shape (banner + nested 0x28 + strings) vs v6 slimmer shape (neither)
// is asserted; nested-0x28 field meanings, the 0x0b u32, the 0x66 u64,
// and the 0x16 strings stay explicitly undecoded — presence + tcode +
// verbatim values only.
//
// Rule: expected names come from the YAML, never from hardcoded labels. The
// mini parser (./m2-replay.ts) is independent of the work/ harness decoder.

import { describe, expect, test } from "bun:test";
import {
	decodeFixtureEntries,
	findEntry,
	loadFixture,
	loadYamlDoc,
	nestedOf,
	required,
	requiredEntry,
} from "./m2-replay";

interface AdoptionRxDoc {
	"source-id-adoption": {
		response: {
			"v7-reply-keys": number[];
			"v6-reply-keys": number[];
			"nested-0x28": { entries: number };
		};
		"reply-values": { v7: string; v6: string; open: string };
	};
}

const V7 = ["7.25-adopt-13-4-rx.json", "7.26beta4-adopt-13-4-rx.json"] as const;
const V6 = "6.49-adopt-13-4-rx.json";

function fmtKey(key: number): string {
	return `0x${key.toString(16).padStart(6, "0")}`;
}

function adoptionDoc(): AdoptionRxDoc["source-id-adoption"] {
	return loadYamlDoc<AdoptionRxDoc>("profiles/winbox-ipc/gui-handlers.yaml")[
		"source-id-adoption"
	];
}

describe("source-id adoption reply replay", () => {
	test("schema carries both reply key lists + OPEN meanings", () => {
		const adoption = adoptionDoc();
		expect(adoption.response["v7-reply-keys"].length).toBe(17);
		expect(adoption.response["v6-reply-keys"].length).toBe(14);
		expect(adoption.response["nested-0x28"].entries).toBe(32);
		expect(adoption["reply-values"].open).toContain("UNKNOWN");
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		for (const name of [...V7, V6]) {
			const fixture = loadFixture(name);
			expect(fixture.records.length).toBe(2);
			for (const record of fixture.records) {
				expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
			}
		}
	});

	test("v7 reply matches the schema key list + nested shape", () => {
		const adoption = adoptionDoc();
		const want = adoption.response["v7-reply-keys"].map(fmtKey);
		for (const name of V7) {
			const fixture = loadFixture(name);
			const reply = required(
				fixture.records.find((r) => r.id === "adopt-rx-full"),
				`${name} adopt-rx-full`,
			);
			expect(reply.to).toEqual([0, 11]);
			expect(reply.from).toEqual([13, 4]);
			const entries = decodeFixtureEntries(reply.hex);
			expect(entries.map((e) => e.key)).toEqual(want);
			// Correlation + echo.
			expect(requiredEntry(entries, "0xff0006", "SYS_REQID").value).toBe(1);
			expect(requiredEntry(entries, "0xff0001", "SYS_TO").value).toEqual([
				0, 11,
			]);
			// Nested 0x28: entry count + tcode only, no field meanings.
			const nested = nestedOf(requiredEntry(entries, "0x000028", "nested"));
			expect(nested.length).toBe(adoption.response["nested-0x28"].entries);
			// Verbatim top-level scalars (wire values, not readings).
			expect(requiredEntry(entries, "0x000026", "0x26").value).toBe(true);
			expect(requiredEntry(entries, "0x00001c", "0x1c").value).toBe(false);
			expect(requiredEntry(entries, "0x000013", "0x13").value).toBe(false);
			expect(requiredEntry(entries, "0x00000f", "0x0f").value).toBe(32);
			expect(requiredEntry(entries, "0x000010", "0x10").value).toBe(6);
			expect(requiredEntry(entries, "0x000018", "0x18").value).toBe("default");
			expect(requiredEntry(entries, "0x000016", "0x16").value).toBe("4.3");
			expect(requiredEntry(entries, "0x000017", "0x17").value).toBe("x86");
			expect(requiredEntry(entries, "0x000015", "0x15").value).toBe("CHR");
			expect(requiredEntry(entries, "0x000011", "0x11").value).toBe("i386");
		}
	});

	test("v6 reply is the slimmer schema shape", () => {
		const adoption = adoptionDoc();
		const want = adoption.response["v6-reply-keys"].map(fmtKey);
		const fixture = loadFixture(V6);
		const reply = required(
			fixture.records.find((r) => r.id === "adopt-rx-full"),
			"v6 adopt-rx-full",
		);
		const entries = decodeFixtureEntries(reply.hex);
		expect(entries.map((e) => e.key)).toEqual(want);
		// Slimmer: no banner, no nested 0x28, no 0x18.
		expect(findEntry(entries, "0xff001c")).toBeUndefined();
		expect(findEntry(entries, "0x000028")).toBeUndefined();
		expect(findEntry(entries, "0x000018")).toBeUndefined();
		expect(requiredEntry(entries, "0x000016", "0x16").value).toBe("3.30");
		expect(requiredEntry(entries, "0xff0006", "SYS_REQID").value).toBe(1);
	});

	test("adoption tx still matches the committed tx fixture bytes", () => {
		// The r-a capture tx must be byte-identical to the long-grounded
		// guess-11 tx (reviewer check 4); guards fixture mix-ups.
		const txFixture = loadFixture("adoption-13-4-tx.json");
		const g11 = required(
			txFixture.records.find((r) => r.id === "adopt-tx-guess-11"),
			"adopt-tx-guess-11",
		);
		for (const name of [...V7, V6]) {
			const fixture = loadFixture(name);
			const tx = required(
				fixture.records.find((r) => r.id === "adopt-tx-guess-11"),
				`${name} tx`,
			);
			expect(tx.hex).toBe(g11.hex);
		}
	});
});
