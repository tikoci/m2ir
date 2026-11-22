// cspell:ignore sfd002a
// [17] undo history as a REST/CLI -> M2 oracle (plan step 4b).
//
// Fixtures: fixtures/winbox-ipc/{7.25,7.26beta4}-undo-oracle.json, made by
// work/2026-11-jg-descriptors/undo-fixture.ts from undo-oracle.ts (no-op
// REST SETs, one CLI property each) and undo-q1.ts (undo/redo) captures.
// Session A subscribes to [17]; each CMD_NOTIFY carries history rows:
// S9 CLI text, Sa inverse CLI, s8 source, m1 native request, m2 inverse.
// The schema entries under test are in profiles/winbox-ipc/undo.yaml and
// gui-handlers.yaml (dns-settings-14-2, address-list-20-35,
// neighbor-discovery-settings).
//
// The mini parser (./m2-replay.ts) is independent of the work/ decoders.

import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type { FixtureEntry, FixtureRecord } from "./m2-replay";
import {
	decodeFixtureEntries,
	findEntry,
	loadFixture,
	loadYamlDoc,
	nestedOf,
	repoPath,
	required,
	requiredEntry,
	rowsOf,
} from "./m2-replay";

const FIXTURE = "7.25-undo-oracle.json";
/** Version -> the source prefix REST changes carry in s8 (drift: api -> rest). */
const VERSIONS: Record<string, string> = { "7.25": "api", "7.26beta4": "rest" };
const NOTIFY = 0xfe000b;
const SET = 0xfe000e;
const SETOBJ = 0xfe0003;
const ADDOBJ = 0xfe0005;
const REMOVEOBJ = 0xfe0006;

interface UndoRecord extends FixtureRecord {
	mark: string;
	decoded: FixtureEntry[];
}
let records: UndoRecord[] = [];
const load = (version: string): UndoRecord[] =>
	loadFixture(`${version}-undo-oracle.json`).records.map((r) => ({
		...(r as UndoRecord),
		decoded: decodeFixtureEntries(r.hex),
	}));

const val = (entries: FixtureEntry[], key: string) =>
	findEntry(entries, key)?.value;
const isSysKey = (k: string) => k.startsWith("0xff00");

/** History rows (with CLI text) notified under one mark. */
function historyRows(mark: string): FixtureEntry[][] {
	return records
		.filter((r) => r.mark === mark && r.cmd === NOTIFY)
		.flatMap((r) => rowsOf(requiredEntry(r.decoded, "0xfe0002", "rows")))
		.filter((row) => ((val(row, "0x000009") as string[]) ?? []).length > 0);
}
function onlyRow(mark: string): FixtureEntry[] {
	const rows = historyRows(mark);
	expect(rows.length).toBe(1);
	return required(rows[0], `row for ${mark}`);
}
const cli = (row: FixtureEntry[]) => (val(row, "0x000009") as string[])[0];
const inverse = (row: FixtureEntry[]) =>
	(val(row, "0x00000a") as string[])[0] ?? "";
const m1 = (row: FixtureEntry[]) =>
	nestedOf(requiredEntry(row, "0x000001", "m1"));
const m2 = (row: FixtureEntry[]) =>
	nestedOf(requiredEntry(row, "0x000002", "m2"));
/** Typed keys a request writes: no SYS_* keys, no row id. */
const written = (m: FixtureEntry[]) =>
	m.filter((e) => !isSysKey(e.key) && e.key !== "0xfe0001");

for (const [version, restSource] of Object.entries(VERSIONS))
	describe(`[17] undo-history oracle fixture (${version})`, () => {
		beforeAll(() => {
			records = load(version);
		});

		test("REST changes carry the version's source prefix", () => {
			const s8 = val(onlyRow("/ip/dns set:cache-size"), "0x000008");
			expect(s8).toBe(`${restSource}:admin@<lab>`);
		});

		test("every [17] message decodes; recorded entries equal the independent decode", () => {
			expect(records.length).toBeGreaterThan(20);
			for (const r of records) {
				if (r.entries) expect(r.decoded).toEqual(r.entries);
				if (r.cmd === NOTIFY) {
					expect(r.from).toEqual([17]);
					rowsOf(requiredEntry(r.decoded, "0xfe0002", "rows"));
				}
			}
		});

		test("history rows: CLI text, inverse, source, request; evictions are removal rows", () => {
			for (const r of records.filter((x) => x.cmd === NOTIFY)) {
				for (const row of rowsOf(
					requiredEntry(r.decoded, "0xfe0002", "rows"),
				)) {
					if (findEntry(row, "0xfe0013")) {
						// History full (100 entries): the oldest row is removed.
						expect(val(row, "0xfe0013")).toBe(1);
						continue;
					}
					expect(Array.isArray(val(row, "0x000009"))).toBe(true);
					expect(Array.isArray(val(row, "0x00000a"))).toBe(true);
					expect(val(row, "0x000008")).toMatch(
						/^[a-z-]+(\([a-z]+\))?:admin@<lab>/,
					);
					expect(val(row, "0x000007")).toBe(0); // wall-clock time zeroed
					expect(typeof val(row, "0xfe0001")).toBe("number");
					expect(m1(row).length).toBeGreaterThan(0);
				}
			}
		});

		test("/ip dns no-op SETs isolate one typed key per CLI property on [14,2]", () => {
			const cases: Array<[string, string, string, unknown]> = [
				["cache-size", "cache-size=2048KiB", "0x000004", 2048],
				["cache-max-ttl", "cache-max-ttl=1w", "0x000006", 604800], // seconds
				["query-server-timeout", "query-server-timeout=2s", "0x00000c", 2000], // ms
				["vrf", "vrf=main", "0x000016", 0], // reference
			];
			for (const [arg, text, key, value] of cases) {
				const row = onlyRow(`/ip/dns set:${arg}`);
				expect(cli(row)).toBe(`/ip dns set ${text}`);
				const req = m1(row);
				expect(val(req, "0xff0001")).toEqual([14, 2]);
				expect(val(req, "0xff0007")).toBe(SET);
				expect(written(req).map((e) => e.key)).toEqual([key]);
				expect(val(req, key)).toEqual(value);
				// A no-op SET records a row with an empty CLI inverse; the native
				// inverse holds only fields that differ, here at most the
				// read-only cache-used counter (f5) when it moved.
				expect(inverse(row)).toBe("");
				for (const e of written(m2(row))) expect(e.key).toBe("0x000005");
			}
			const servers = written(m1(onlyRow("/ip/dns set:servers")));
			expect(servers).toEqual([{ key: "0x00000a", tcode: "0xa8", value: [] }]);
		});

		test("[20,17] serves conntrack and neighbor discovery settings", () => {
			const conn = m1(
				onlyRow("/ip/firewall/connection/tracking set:tcp-established-timeout"),
			);
			expect(val(conn, "0xff0001")).toEqual([20, 17]);
			expect(written(conn).map((e) => e.key)).toEqual(["0x000004"]);
			expect(val(conn, "0x000004")).toBe(8640000); // 1d in centiseconds

			const suffix = m1(
				onlyRow("/ip/neighbor/discovery-settings set:add-dns-entries-suffix"),
			);
			expect(val(suffix, "0xff0001")).toEqual([20, 17]);
			expect(written(suffix)).toEqual([
				{ key: "0x00004f", tcode: "0x21", value: "lan" },
			]);

			const proto = m1(onlyRow("/ip/neighbor/discovery-settings set:protocol"));
			expect(val(proto, "0x000037")).toBe(7); // cdp,lldp,mndp bit set

			const list = m1(
				onlyRow("/ip/neighbor/discovery-settings set:discover-interface-list"),
			);
			expect(
				written(list)
					.map((e) => e.key)
					.sort(),
			).toEqual(["0x000034", "0x000035"]);
		});

		test("address-list: ADDOBJ / SETOBJ / REMOVEOBJ on [20,35], IPv4 as u32 LE, full-record inverse", () => {
			const le = (a: number, b: number, c: number, d: number) =>
				(a | (b << 8) | (c << 16) | (d << 24)) >>> 0;
			const add = onlyRow("/ip/firewall/address-list add");
			expect(val(m1(add), "0xff0007")).toBe(ADDOBJ);
			expect(val(m1(add), "0x000003")).toBe(le(192, 0, 2, 1));
			expect(val(m1(add), "0x000004")).toBe(le(192, 0, 2, 1));
			expect(val(m2(add), "0xff0007")).toBe(REMOVEOBJ);

			const comment = m1(onlyRow("/ip/firewall/address-list set:comment"));
			expect(val(comment, "0xff0007")).toBe(SETOBJ);
			expect(written(comment).map((e) => e.key)).toEqual(["0xfe0009"]);
			// sfd002a = "" appears when the CLI picks the row with [find ...]
			// (q1 run), not with numbers=*N (oracle run).
			const viaFind = m1(onlyRow("q1-table-noop-comment"));
			expect(cli(onlyRow("q1-table-noop-comment"))).toContain(" set *");
			expect(
				written(viaFind)
					.map((e) => e.key)
					.sort(),
			).toEqual(["0xfd002a", "0xfe0009"]);
			expect(val(viaFind, "0xfd002a")).toBe("");

			const remove = onlyRow("/ip/firewall/address-list remove");
			expect(val(m1(remove), "0xff0007")).toBe(REMOVEOBJ);
			expect(inverse(remove)).toStartWith(
				"/ip firewall address-list add address=192.0.2.1 ",
			);
			const record = written(m2(remove)).map((e) => e.key);
			expect(val(m2(remove), "0xff0007")).toBe(ADDOBJ);
			for (const k of [
				"0x000003",
				"0x000004",
				"0xfe0007",
				"0xfe0009",
				"0xfe000a",
				"0xfe0010",
			])
				expect(record).toContain(k);
			expect(val(m2(remove), "0x00000a")).toBe(0); // creation time, zeroed

			const v6 = written(
				m1(onlyRow("/ipv6/firewall/address-list set:address")),
			);
			expect(v6.map((e) => e.tcode).sort()).toEqual(["0x18", "0x9"]); // bytes16 + prefix length
		});

		test("undo and redo re-notify the same row; a write after undo drops the redo branch", () => {
			const changed = onlyRow("q1-table-comment");
			const id = val(changed, "0xfe0001");
			const undoTx = required(
				records.find(
					(r) => r.mark === "q1-table-undo-comment" && r.cmd === 0x80001,
				),
				"undo request",
			);
			expect(undoTx.to).toEqual([17]);
			const reply = required(
				records.find(
					(r) =>
						r.mark === "q1-table-undo-comment" &&
						r.reqId === undoTx.reqId &&
						r.cmd === null,
				),
				"undo reply",
			);
			expect(val(reply.decoded, "0xff0002")).toEqual([17, 20, 35]); // forwarded to the owner
			const undone = onlyRow("q1-table-undo-comment");
			expect(val(undone, "0xfe0001")).toBe(id);
			expect(val(undone, "0x000004")).toBe(1);
			expect(val(undone, "0x000008")).toEndWith("/undo");
			expect(val(changed, "0x000004")).toBe(0);

			const redone = onlyRow("q1-table-redo-add");
			expect(val(redone, "0x000004")).toBe(0);
			expect(val(redone, "0x000008")).toEndWith("/redo");

			const peek = required(
				records.find((r) => r.mark === "q1-peek-redo-empty" && r.cmd === null),
				"peek-redo reply",
			);
			expect(val(peek.decoded, "0xff0004")).toBe(2);
			expect(val(peek.decoded, "0xff0009")).toBe("nothing to redo");
		});

		test("no lab address, credential or wall-clock time survives sanitizing", () => {
			const strings = (es: FixtureEntry[]): string[] =>
				es.flatMap((e) => {
					const v = e.value;
					if (typeof v === "string") return [v];
					if (Array.isArray(v))
						return v.flatMap((x) =>
							typeof x === "string"
								? [x]
								: Array.isArray(x)
									? strings(x as FixtureEntry[])
									: [],
						);
					return [];
				});
			const nested = (es: FixtureEntry[]): FixtureEntry[] =>
				es.flatMap((e) =>
					e.tcode === "0x28" || e.tcode === "0x29"
						? [e, ...nested(e.value as FixtureEntry[])]
						: e.tcode === "0xa8"
							? [e, ...(e.value as FixtureEntry[][]).flatMap(nested)]
							: [e],
				);
			for (const r of records) {
				const all = nested(r.decoded);
				for (const s of strings(all)) {
					expect(s).not.toMatch(/\b(10\.\d+|127\.0\.0|192\.168)\.\d+\.\d+\b/);
					expect(s).not.toMatch(/admin@(?!<lab>)/);
				}
				for (const e of all)
					if (typeof e.value === "number" && e.value > 1.7e9 && e.value < 2.1e9)
						// Only IPv4 values (documentation ranges) may look like Unix times.
						expect([0xc0, 0x00]).toContain(e.value & 0xff);
			}
		});
	});

interface HandlerField {
	name: string;
	tcode?: string;
}
interface Handler {
	"sys-to": number[];
	fields: {
		map?: Record<string, HandlerField>;
		"namespace-user"?: Record<string, HandlerField>;
		"namespace-session"?: Record<string, HandlerField>;
	};
	evidence: Array<{ source: string; ref: string }>;
}

describe("profile entries promoted from the oracle", () => {
	const gui = loadYamlDoc<{ handlers: Record<string, Handler> }>(
		"profiles/winbox-ipc/gui-handlers.yaml",
	);
	test("gui-handlers names match the fixture's isolated keys", () => {
		const dns = required(gui.handlers["dns-settings-14-2"], "dns");
		expect(dns["sys-to"]).toEqual([14, 2]);
		expect(dns.fields.map?.["4"]?.name).toBe("cache-size");
		expect(dns.fields.map?.["12"]?.name).toBe("query-server-timeout");
		const nd = required(gui.handlers["neighbor-discovery-settings"], "[20,17]");
		expect(nd.fields.map?.["79"]?.name).toBe("add-dns-entries-suffix");
		expect(nd.fields.map?.["55"]?.name).toBe("protocol");
		const al = required(gui.handlers["address-list-20-35"], "address-list");
		expect(al.fields["namespace-user"]?.["3"]?.name).toBe("address");
		expect(al.fields["namespace-session"]?.["16"]?.name).toBe("list");
		for (const h of [dns, nd, al]) {
			expect(
				h.evidence.some(
					(e) => e.source === "sample" && e.ref.includes(FIXTURE),
				),
			).toBe(true);
			expect(h.evidence.some((e) => e.source === "doc")).toBe(true);
		}
	});

	test("undo.yaml describes [17] from this fixture", () => {
		const undo = loadYamlDoc<{
			route: number[];
			"row-keys": Record<string, unknown>;
			evidence: Array<{ source: string; ref: string }>;
		}>("profiles/winbox-ipc/undo.yaml");
		expect(undo.route).toEqual([17]);
		for (const k of [
			"0x000009",
			"0x00000a",
			"0x000008",
			"0x000001",
			"0x000002",
		])
			expect(Object.keys(undo["row-keys"])).toContain(k);
		expect(
			undo.evidence.some(
				(e) => e.source === "sample" && e.ref.includes(FIXTURE),
			),
		).toBe(true);
		expect(
			existsSync(
				repoPath("work/2026-11-jg-descriptors/undo-oracle-mapping-7.25.md"),
			),
		).toBe(true);
	});
});
