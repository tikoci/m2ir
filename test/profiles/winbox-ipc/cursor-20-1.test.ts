// Validated-cursor [20,1] replay (6.49.23 + 7.25 + 7.26beta4).
//
// The schema entry under test lives in
// profiles/winbox-ipc/gui-handlers.yaml (ip-address notes: s=0/999 ->
// UNKNOWNID + total, s=1 -> one row + total). The wire bytes live in
// fixtures/winbox-ipc/{6.49,7.25,7.26beta4}-getall-20-1-cursor.json,
// sanitized from the queue-1 r-b manifests — the first transcripts for
// these legs (previously observation-only).
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

interface GuiHandlersDoc {
	handlers: Record<string, { "sys-to": number[]; notes: string }>;
}

interface StdErrorsDoc {
	errors: Record<string, { "canonical-name"?: string }>;
}

const ALL = [
	"6.49-getall-20-1-cursor.json",
	"7.25-getall-20-1-cursor.json",
	"7.26beta4-getall-20-1-cursor.json",
] as const;

describe("cursor [20,1] replay", () => {
	test("schema carries the validated-cursor transcript note", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const handler = required(gui.handlers["ip-address"], "handlers.ip-address");
		expect(handler["sys-to"]).toEqual([20, 1]);
		expect(handler.notes).toContain("VALIDATED row-id cursor");
		expect(handler.notes).toContain("Transcript-proven");

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

	test("s=0 and s=999 are UNKNOWNID + total, all versions", () => {
		for (const name of ALL) {
			for (const stem of ["cursor-leg-s0", "cursor-leg-s999"]) {
				const tx = decodeFixtureEntries(
					required(
						loadFixture(name).records.find((r) => r.id === `${stem}-tx`),
						`${name} ${stem}-tx`,
					).hex,
				);
				// Bare-only legs: 0xfe0003 start cursor, nothing else.
				expect(
					tx.filter((e) => e.key.startsWith("0xfe00")).map((e) => e.key),
				).toEqual(["0xfe0003"]);
				const rx = decodeFixtureEntries(
					required(
						loadFixture(name).records.find((r) => r.id === `${stem}-rx`),
						`${name} ${stem}-rx`,
					).hex,
				);
				expect(requiredEntry(rx, "0xff0008", "SYS_ERRNO").value).toBe(0xfe0004);
				expect(requiredEntry(rx, "0xfe0019", "STD_OBJ_COUNT").value).toBe(1);
				expect(findEntry(rx, "0xfe0002")).toBeUndefined();
			}
		}
	});

	test("s=1 returns one row + total, all versions", () => {
		for (const name of ALL) {
			const rx = decodeFixtureEntries(
				required(
					loadFixture(name).records.find((r) => r.id === "cursor-leg-s1-rx"),
					`${name} cursor-leg-s1-rx`,
				).hex,
			);
			const rows = rowsOf(requiredEntry(rx, "0xfe0002", "STD_OBJS"));
			expect(rows.length).toBe(1);
			expect(
				requiredEntry(required(rows[0], `${name} row 0`), "0xfe0001", "row-id")
					.value,
			).toBe(1);
			expect(requiredEntry(rx, "0xfe0019", "STD_OBJ_COUNT").value).toBe(1);
			expect(findEntry(rx, "0xff0008")).toBeUndefined();
		}
	});
});
