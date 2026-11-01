// [20,61] LTE-hardware negative replay (7.16.2 stable, mipsbe, real hardware).
//
// The schema entry under test lives in
// profiles/winbox-ipc/gui-handlers.yaml (modem-aux-20-61); the error name
// comes from profiles/winbox-ipc/std-errors.yaml and the banner name from
// profiles/winbox-ipc/sys-keys.yaml. The wire bytes live in
// fixtures/winbox-ipc/7.16-neg-20-61-lte.json: GET bare/f7=lte1/f7=lte2/
// f7=foo negatives plus GETCOUNT ok — sanitized from the queue-3 item-5
// cap13 manifest (one read-only session against LTE hardware).
//
// Real modem names (lte1/lte2 from the step-0 /interface/lte snapshot)
// miss exactly like foo: interface/TYPEOBJ-row presence is INSUFFICIENT
// for a [20,61] hit. GETCOUNT answers ok + 0xFFFFFFFF in the v7 slot,
// extending the version-slot division below 7.25 and off x86/CHR.
// First 7.16.2 + mipsbe + real-hardware transcripts; proxy banner
// sighting msg-proxy-7.16.2.
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

interface GuiHandlersDoc {
	handlers: Record<
		string,
		{ role?: string; notes?: string; "sys-to"?: number[] }
	>;
}

interface StdErrorsDoc {
	errors: Record<string, { "canonical-name"?: string }>;
}

interface SysKeysDoc {
	keys: Record<string, { "canonical-name"?: string }>;
}

const NAME = "7.16-neg-20-61-lte.json";

const UNKNOWNID = 0xfe0004;

function recordById(id: string) {
	const fixture = loadFixture(NAME);
	return required(
		fixture.records.find((r) => r.id === id),
		`${NAME} ${id}`,
	);
}

function errnoOf(entries: FixtureEntry[]): number {
	return requiredEntry(entries, "0xff0008", "SYS_ERRNO").value as number;
}

describe("lte neg [20,61] replay", () => {
	test("schema binds modem-aux-20-61 + UNKNOWNID/banner names", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const entry = required(gui.handlers["modem-aux-20-61"], "modem-aux-20-61");
		expect(entry["sys-to"]).toEqual([20, 61]);
		expect(required(entry.role, "modem-aux role")).toContain("INSUFFICIENT");
		expect(required(entry.notes, "modem-aux notes")).toContain(
			"msg-proxy-7.16.2",
		);

		const errors = loadYamlDoc<StdErrorsDoc>(
			"profiles/winbox-ipc/std-errors.yaml",
		);
		expect(
			required(errors.errors[String(UNKNOWNID)], "0xfe0004")["canonical-name"],
		).toBe("ERROR_UNKNOWNID");

		const sys = loadYamlDoc<SysKeysDoc>("profiles/winbox-ipc/sys-keys.yaml");
		expect(sys.keys[String(0xff001c)]?.["canonical-name"]).toBe(
			"SYS_PROXY_BANNER",
		);
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture(NAME);
		expect(fixture.records.length).toBe(10);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("GET bare/f7 miss with UNKNOWNID, no total/errstr/rows", () => {
		const legs = [
			"lte-neg-20-61-get-bare",
			"lte-neg-20-61-get-f7-lte1",
			"lte-neg-20-61-get-f7-lte2",
			"lte-neg-20-61-get-f7-foo",
		];
		for (const stem of legs) {
			const rx = decodeFixtureEntries(recordById(`${stem}-rx`).hex);
			expect(errnoOf(rx)).toBe(UNKNOWNID);
			expect(requiredEntry(rx, "0xff0002", "SYS_FROM").value).toEqual([20, 61]);
			expect(findEntry(rx, "0xfe0019")).toBeUndefined();
			expect(findEntry(rx, "0xfe0014")).toBeUndefined();
			expect(findEntry(rx, "0xff0009")).toBeUndefined();
			expect(findEntry(rx, "0xfe0002")).toBeUndefined();
			// Same 7-key SYS-only envelope as the CHR legs.
			expect(rx.map((e) => e.key).sort()).toEqual(
				[
					"0xff0001",
					"0xff0002",
					"0xff0003",
					"0xff0004",
					"0xff0006",
					"0xff0008",
					"0xff001c",
				].sort(),
			);
		}
	});

	test("probe tx bytes genuinely differ per selector", () => {
		const bare = recordById("lte-neg-20-61-get-bare-tx");
		const lte1 = recordById("lte-neg-20-61-get-f7-lte1-tx");
		const lte2 = recordById("lte-neg-20-61-get-f7-lte2-tx");
		const foo = recordById("lte-neg-20-61-get-f7-foo-tx");
		// Bare carries no USER-namespace extras.
		expect(
			decodeFixtureEntries(bare.hex).filter((e) => e.key.startsWith("0x00000"))
				.length,
		).toBe(0);
		// f7 selectors arrive as compact strings, one per probe.
		expect(
			requiredEntry(decodeFixtureEntries(lte1.hex), "0x000007", "f7").value,
		).toBe("lte1");
		expect(
			requiredEntry(decodeFixtureEntries(lte2.hex), "0x000007", "f7").value,
		).toBe("lte2");
		expect(
			requiredEntry(decodeFixtureEntries(foo.hex), "0x000007", "f7").value,
		).toBe("foo");
		// Byte-level, independent of the decoder.
		expect(lte1.hex).toContain("07000021046c746531");
		expect(lte2.hex).toContain("07000021046c746532");
		expect(foo.hex).toContain("0700002103666f6f");
	});

	test("GETCOUNT answers ok + 0xFFFFFFFF in the v7 slot", () => {
		const rx = recordById("lte-neg-20-61-getcount-bare-rx");
		const entries = decodeFixtureEntries(rx.hex);
		expect(findEntry(entries, "0xff0008")).toBeUndefined();
		expect(requiredEntry(entries, "0xfe0019", "STD_OBJ_COUNT").value).toBe(
			0xffffffff,
		);
		expect(findEntry(entries, "0xfe0014")).toBeUndefined();
		// Byte-level, independent of the decoder.
		expect(rx.hex).toContain("1900fe08ffffffff");
		expect(rx.hex).not.toContain("1400fe");
	});

	test("every reply carries the 7.16.2 proxy banner", () => {
		const fixture = loadFixture(NAME);
		const replies = fixture.records.filter((r) => r.cmd === null);
		expect(replies.length).toBe(5);
		for (const record of replies) {
			const entries = decodeFixtureEntries(record.hex);
			expect(
				requiredEntry(entries, "0xff001c", `${record.id} banner`).value,
			).toEqual(["msg-proxy-7.16.2"]);
		}
	});
});
