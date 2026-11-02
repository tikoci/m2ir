// J5 thread-5 adjunct leg, standalone 8w+0r: 0x0b is the IP protocol
// number (3-point pin 6/tcp + 17/udp + 1/icmp); the matcher triple is
// computed (appears post-hoc on set, tracks 6->17); 0x16 is a constant
// adjunct and 0x194 any-protocol gating; 0x1c6 presence is
// action-computed but the value diverges (false on post-hoc set vs true
// on G1 add) and clears on action-exit.
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (filter-20-3 fields 11/22/404/
// 454). The wire bytes live in
// fixtures/winbox-ipc/7.25-filter-thread5.json (6 cell GETALL rx),
// captured on ws21 (7.25) by the J5 leg.
//
// Rule: expected names come from the YAML, never from hardcoded labels. The
// mini parser (./m2-replay.ts) is independent of the work/ harness decoder.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
	decodeFixtureEntries,
	type FixtureEntry,
	loadFixture,
	loadYamlDoc,
	repoPath,
	required,
	requiredEntry,
	rowsOf,
} from "./m2-replay";

interface GuiHandlersDoc {
	handlers: Record<
		string,
		{
			fields?: {
				"namespace-user"?: Record<
					string,
					{ name?: string; role?: string; values?: Record<string, string> }
				>;
			};
		}
	>;
}

const FIXTURE = "7.25-filter-thread5.json";
const J5 = "work/2026-11-winbox-attributes/proof/j5-thread-5-exec";

function cellRows(recordId: string): FixtureEntry[][] {
	const fixture = loadFixture(FIXTURE);
	const byId = new Map(fixture.records.map((r) => [r.id, r]));
	const rx = decodeFixtureEntries(required(byId.get(recordId), recordId).hex);
	return rowsOf(requiredEntry(rx, "0xfe0002", `${recordId} rows`));
}

function fieldOf(
	row: FixtureEntry[],
	key: string,
): FixtureEntry["value"] | undefined {
	return row.find((e) => e.key === key)?.value;
}

describe("thread-5 adjunct replay", () => {
	test("schema carries the protocol + adjunct field entries", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const fields = required(
			gui.handlers["filter-20-3"]?.fields?.["namespace-user"],
			"filter namespace-user",
		);
		const f11 = required(fields["11"], "f11");
		expect(f11.name).toBe("protocol");
		expect(f11.values).toEqual({ 1: "icmp", 6: "tcp", 17: "udp" });
		expect(required(fields["22"], "f22").name).toBe("unknown-22");
		expect(required(fields["404"], "f404").name).toBe("unknown-404");
		const f454 = required(fields["454"], "f454");
		expect(f454.name).toBe("unknown-454");
		expect(required(f454.role, "f454 role")).toContain("DIVERGENT");
	});

	test("promoted evidence references resolve to tracked files", () => {
		for (const rel of [
			`${J5}/report.yaml`,
			`${J5}/step-T5a-udp.jsonl`,
			`${J5}/step-T5a-icmp.jsonl`,
			`${J5}/step-T5b-base.jsonl`,
			`${J5}/step-T5b-tcp.jsonl`,
			`${J5}/step-T5b-udp.jsonl`,
			`${J5}/step-T5c-ft.jsonl`,
			`${J5}/step-T5c-accept.jsonl`,
			`fixtures/winbox-ipc/${FIXTURE}`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture(FIXTURE);
		expect(fixture.provenance.routeros_version).toBe("7.25");
		expect(fixture.records.length).toBe(6);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("protocol vary pins 0x0b to 17/udp and 1/icmp", () => {
		const udp = required(cellRows("getall-20-3-j5-udp-row-rx")[0], "udp row");
		expect(fieldOf(udp, "0x00000b")).toBe(17);
		expect(fieldOf(udp, "0x000016")).toBe(false);
		expect(fieldOf(udp, "0x000194")).toBe(true);
		const icmp = required(
			cellRows("getall-20-3-j5-icmp-row-rx")[0],
			"icmp row",
		);
		expect(fieldOf(icmp, "0x00000b")).toBe(1);
		expect(fieldOf(icmp, "0x000016")).toBe(false);
		expect(fieldOf(icmp, "0x000194")).toBe(true);
	});

	test("post-hoc sets grow the triple and track 6->17", () => {
		const tcp = required(
			cellRows("getall-20-3-j5-set-tcp-row-rx")[0],
			"tcp row",
		);
		expect(fieldOf(tcp, "0x00000b")).toBe(6);
		const tracked = required(
			cellRows("getall-20-3-j5-tracked-udp-row-rx")[0],
			"tracked row",
		);
		expect(fieldOf(tracked, "0x00000b")).toBe(17);
		expect(fieldOf(tracked, "0xfe0001")).toBe(fieldOf(tcp, "0xfe0001"));
	});

	test("fasttrack set grows 0x1c6-false plus a dummy; exit clears", () => {
		const ft = cellRows("getall-20-3-j5-fasttrack-row-rx");
		expect(ft.length).toBe(2);
		const host = required(
			ft.find((r) => fieldOf(r, "0xfe0009") === "j5-t5-host"),
			"host row",
		);
		expect(fieldOf(host, "0x0001c6")).toBe(false);
		const exited = cellRows("getall-20-3-j5-exit-row-rx");
		const hostAfter = required(
			exited.find((r) => fieldOf(r, "0xfe0009") === "j5-t5-host"),
			"host row after exit",
		);
		expect(fieldOf(hostAfter, "0x0001c6")).toBe(undefined);
	});
});
