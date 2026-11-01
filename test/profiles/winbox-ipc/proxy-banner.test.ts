// v7 proxy-banner (0xff001c) presence replay across Tier-1 fixtures.
//
// The schema entry under test lives in profiles/winbox-ipc/sys-keys.yaml
// (0xff001c SYS_PROXY_BANNER). No new fixture: this test reuses the reply
// envelopes from the Tier-1 fixtures (sessions, resource, error-envelope,
// ip-address, plus the identity promotion fixture).
//
// A record is a reply iff it carries no SYS_CMD (requests do, replies do
// not). Tx-only records (adoption, setobj) are out of scope by shape.
//
// Rule: expected names come from the YAML, never from hardcoded labels. The
// mini parser (./m2-replay.ts) is independent of the work/ harness decoder.

import { describe, expect, test } from "bun:test";
import {
	decodeFixtureEntries,
	type FixtureRecord,
	findEntry,
	loadFixture,
	loadYamlDoc,
	required,
	requiredEntry,
} from "./m2-replay";

interface SysKeysDoc {
	keys: Record<string, { "canonical-name"?: string }>;
}

const V7_FILES = [
	"7.25-getall-13-4-sessions.json",
	"7.25-getone-24-2-resource.json",
	"7.25-error-envelope.json",
	"7.25-getall-20-1.json",
	"7.25-set-24-1-identity.json",
];

const V6_FILES = [
	"6.49-getone-24-2-resource.json",
	"6.49-error-envelope.json",
	"6.49-getall-20-1.json",
];

function replyRecords(files: string[]): FixtureRecord[] {
	return files.flatMap((name) =>
		loadFixture(name).records.filter((r) => r.cmd === null),
	);
}

describe("proxy banner replay", () => {
	test("schema names 0xff001c the proxy banner", () => {
		const sys = loadYamlDoc<SysKeysDoc>("profiles/winbox-ipc/sys-keys.yaml");
		expect(sys.keys[String(0xff001c)]?.["canonical-name"]).toBe(
			"SYS_PROXY_BANNER",
		);
	});

	test("every 7.25 reply carries the banner", () => {
		const replies = replyRecords(V7_FILES);
		// Per-file reply counts: sessions 1, resource 1, errors 6,
		// ip-address 1, identity 5 (2 tx excluded).
		expect(replies.length).toBe(1 + 1 + 6 + 1 + 5);
		for (const record of replies) {
			const entries = decodeFixtureEntries(record.hex);
			expect(
				requiredEntry(entries, "0xff001c", `${record.id} banner`).value,
			).toEqual(["msg-proxy-7.25"]);
		}
	});

	test("no 6.49 reply carries the banner", () => {
		const replies = replyRecords(V6_FILES);
		// Per-file reply counts: resource 1, errors 1, ip-address 1.
		expect(replies.length).toBe(1 + 1 + 1);
		for (const record of replies) {
			const entries = decodeFixtureEntries(record.hex);
			expect(findEntry(entries, "0xff001c")).toBeUndefined();
			// Sanity: these really are server replies, not requests.
			const from = required(record.from ?? undefined, `${record.id} from`);
			expect(from[0]).not.toBe(0);
		}
	});
});
