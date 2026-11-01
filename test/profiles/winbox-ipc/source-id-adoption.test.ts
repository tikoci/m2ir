// Source-id adoption tx replay: GET [13,4] with a client-chosen guess.
//
// The schema entries under test live in profiles/winbox-ipc/gui-handlers.yaml
// (source-id-adoption) and profiles/winbox-ipc/commands.yaml (legacy 0x07
// cmdGet). The wire bytes live in
// fixtures/winbox-ipc/adoption-13-4-tx.json.
//
// Tx legs only; the full adoption reply is replayed separately in
// ./source-id-adoption-rx.test.ts against
// {6.49,7.25,7.26beta4}-adopt-13-4-rx.json (queue-1 capture batch).
// The guess-11 request bytes are byte-grounded against the captured
// real-client first message (probe.ts MR_FIRST_MSG_HEX).
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
} from "./m2-replay";

interface AdoptionDoc {
	"source-id-adoption": {
		request: {
			"sys-to": number[];
			"sys-cmd": { value: number; name: string };
		};
	};
}

interface LegacyCommandsDoc {
	"legacy-short-form": Record<string, { "canonical-name"?: string }>;
}

// Captured WinBox.exe first message; probe.ts asserts its encoder against
// this on every login with the default guess.
const MR_FIRST_MSG_HEX =
	"4d320500ff010600ff09010700ff09070100ff88" +
	"02000d000000040000000200ff880200000000000b000000";

describe("source-id adoption tx replay", () => {
	test("schema carries the [13,4] cmdGet adoption request", () => {
		const gui = loadYamlDoc<AdoptionDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const req = gui["source-id-adoption"].request;
		expect(req["sys-to"]).toEqual([13, 4]);
		expect(req["sys-cmd"].value).toBe(0x07);
		expect(req["sys-cmd"].name).toBe("cmdGet");

		const cmds = loadYamlDoc<LegacyCommandsDoc>(
			"profiles/winbox-ipc/commands.yaml",
		);
		const short = required(cmds["legacy-short-form"], "legacy-short-form");
		expect(short[String(0x07)]?.["canonical-name"]).toBe("cmdGet");
	});

	test("fixture tx hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture("adoption-13-4-tx.json");
		expect(fixture.records.length).toBe(4);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("each guess rides SYS_FROM with the schema request shape", () => {
		const gui = loadYamlDoc<AdoptionDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const req = gui["source-id-adoption"].request;
		const fixture = loadFixture("adoption-13-4-tx.json");
		const guesses: number[] = [];
		for (const record of fixture.records) {
			const entries = decodeFixtureEntries(record.hex);
			// Request shape: REPLYEXP + REQID + CMD + TO + FROM, no TYPE.
			expect(record.cmd).toBe(req["sys-cmd"].value);
			expect(record.to).toEqual(req["sys-to"]);
			expect(findEntry(entries, "0xff0005")?.value).toBe(true);
			expect(findEntry(entries, "0xff0003")).toBeUndefined();
			const from = required(
				findEntry(entries, "0xff0002")?.value as number[] | undefined,
				`${record.id} SYS_FROM`,
			);
			expect(from[0]).toBe(0);
			guesses.push(from[1] as number);
		}
		// Four distinct client guesses incl. the prober default 11.
		expect(guesses).toEqual([8, 11, 42, 77]);
		expect(new Set(guesses).size).toBe(4);
	});

	test("guess-11 tx equals the captured real-client bytes", () => {
		const fixture = loadFixture("adoption-13-4-tx.json");
		const g11 = required(
			fixture.records.find((r) => r.id === "adopt-tx-guess-11"),
			"adopt-tx-guess-11",
		);
		expect(g11.hex).toBe(MR_FIRST_MSG_HEX);
	});
});
