// Active-sessions [13,4] GETALL replay (7.25 + 7.26beta4 + 6.49.23).
//
// The schema entry under test lives in
// profiles/winbox-ipc/gui-handlers.yaml (active-sessions-13-4). The wire
// bytes live in fixtures/winbox-ipc/7.25-getall-13-4-sessions.json
// (sanitized from work/2026-10-chr-extraction/ws3c/ev/7.25-getall-13-4.json)
// plus the queue-1 multihold fixtures
// {6.49,7.25,7.26beta4}-getall-13-4-multihold.json (A1/A2/A3 legs with a
// held second session; 6.49 GETALL now probed).
//
// f1/f2/f3/f4 are decoded by row-id join vs REST /user/active (the REST
// `when`/`address`/`via` values pinned below come from the manifests'
// independentReads, not from the M2 bytes under test). f5/f6/f8 stay
// OPEN/constant: presence + value only, no decode.
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

interface FieldDef {
	name: string;
	tcode?: string;
	role?: string;
}

interface GuiHandlersDoc {
	handlers: Record<
		string,
		{
			"sys-to": number[];
			fields: {
				"row-id"?: { namespace: string; field: number };
				"namespace-user"?: Record<string, FieldDef>;
			};
			notes: string;
			"revision-history"?: { belief: string; outcome: string }[];
		}
	>;
}

interface StdKeysDoc {
	keys: Record<string, { "canonical-name"?: string }>;
}

function sessionFields(): Map<number, FieldDef> {
	const gui = loadYamlDoc<GuiHandlersDoc>(
		"profiles/winbox-ipc/gui-handlers.yaml",
	);
	const handler = required(
		gui.handlers["active-sessions-13-4"],
		"handlers.active-sessions-13-4",
	);
	const user = required(handler.fields["namespace-user"], "namespace-user");
	const fields = new Map<number, FieldDef>();
	for (const [raw, def] of Object.entries(user)) {
		fields.set(Number(raw), def);
	}
	return fields;
}

function keyOf(fields: Map<number, FieldDef>, name: string): string {
	for (const [id, def] of fields) {
		if (def.name === name) {
			return `0x${id.toString(16).padStart(6, "0")}`;
		}
	}
	throw new Error(`no field named ${name}`);
}

/** u32 value -> dotted quad via its LE bytes (the f3 encoding). */
function quadOf(value: number): string {
	const bytes = [
		(value >>> 0) & 0xff,
		(value >>> 8) & 0xff,
		(value >>> 16) & 0xff,
		(value >>> 24) & 0xff,
	];
	return bytes.join(".");
}

/** Epoch -> "YYYY-MM-DD HH:MM:SS" UTC (the f1 encoding). */
function utcOf(epoch: number): string {
	return new Date(epoch * 1000).toISOString().replace("T", " ").slice(0, 19);
}

const MULTIHOLD = [
	"7.25-getall-13-4-multihold.json",
	"7.26beta4-getall-13-4-multihold.json",
	"6.49-getall-13-4-multihold.json",
] as const;

// Row-id sets per leg (A2 adds exactly the held session-B row; A3 drops
// it). From the cap2 manifests' rx reqId 18/19/20.
const ROW_IDS: Record<string, { a1: number[]; a2: number[]; a3: number[] }> = {
	"7.25-getall-13-4-multihold.json": {
		a1: [3, 4, 5],
		a2: [3, 4, 5, 6],
		a3: [3, 4, 5],
	},
	"7.26beta4-getall-13-4-multihold.json": {
		a1: [3, 4, 5],
		a2: [3, 4, 5, 6],
		a3: [3, 4, 5],
	},
	"6.49-getall-13-4-multihold.json": { a1: [1, 5], a2: [1, 5, 11], a3: [1, 5] },
};

// f1 epoch -> REST /user/active `when` (UTC; v6 REST prints `nov/01/2026`
// for the same instants). From the cap2 manifests' independentReads.
const WHEN: Record<string, Record<number, string>> = {
	"7.25-getall-13-4-multihold.json": {
		3: "2026-11-01 14:29:11",
		4: "2026-11-01 14:29:11",
		5: "2026-11-01 14:29:17",
		6: "2026-11-01 14:29:19",
	},
	"7.26beta4-getall-13-4-multihold.json": {
		3: "2026-11-01 14:31:30",
		4: "2026-11-01 14:31:30",
		5: "2026-11-01 14:31:37",
		6: "2026-11-01 14:31:38",
	},
	"6.49-getall-13-4-multihold.json": {
		1: "2026-11-01 14:30:32",
		5: "2026-11-01 14:30:38",
		11: "2026-11-01 14:30:39",
	},
};

// Row-id -> REST `address` presence (f3 present-iff-addressed) + `via`
// (f4). From the cap2 manifests' independentReads.
const REST_JOIN: Record<
	string,
	Record<number, { address: string | null; via: string }>
> = {
	"7.25-getall-13-4-multihold.json": {
		3: { address: "10.0.2.2", via: "rest-api" },
		4: { address: null, via: "api" },
		5: { address: "10.0.2.2", via: "winbox" },
		6: { address: "10.0.2.2", via: "winbox" },
	},
	"7.26beta4-getall-13-4-multihold.json": {
		3: { address: "10.0.2.2", via: "rest-api" },
		4: { address: null, via: "rest-api" },
		5: { address: "10.0.2.2", via: "winbox" },
		6: { address: "10.0.2.2", via: "winbox" },
	},
	"6.49-getall-13-4-multihold.json": {
		1: { address: "10.0.2.2", via: "api" },
		5: { address: "10.0.2.2", via: "winbox" },
		11: { address: "10.0.2.2", via: "winbox" },
	},
};

const VIA_F4: Record<string, number> = { winbox: 1, api: 9, "rest-api": 13 };

describe("sessions [13,4] GETALL replay", () => {
	test("schema carries the decoded sessions mapping + 6.49 probed", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const handler = required(
			gui.handlers["active-sessions-13-4"],
			"handlers.active-sessions-13-4",
		);
		expect(handler["sys-to"]).toEqual([13, 4]);
		const fields = sessionFields();
		expect(fields.get(1)?.name).toBe("login-time");
		expect(fields.get(2)?.name).toBe("username");
		expect(fields.get(3)?.name).toBe("peer-ipv4");
		expect(fields.get(4)?.name).toBe("transport");
		expect(fields.get(5)?.name).toBe("unknown-5");
		expect(fields.get(6)?.name).toBe("unknown-6");
		expect(fields.get(8)?.name).toBe("unknown-8");
		// The f4 transport enum lives in the YAML role, not here.
		const role = required(fields.get(4)?.role, "transport role");
		expect(role).toContain("1=winbox");
		expect(role).toContain("9=api");
		expect(role).toContain("13=rest-api");
		// 6.49 GETALL is probed now; the OPEN f1/f3 stamps are superseded.
		expect(handler.notes).toContain("6.49");
		expect(handler.notes).not.toContain("NOT probed");
		const history = required(handler["revision-history"], "revision-history");
		expect(history.filter((h) => h.outcome === "superseded").length).toBe(2);

		const std = loadYamlDoc<StdKeysDoc>("profiles/winbox-ipc/std-keys.yaml");
		expect(std.keys[String(0xfe0019)]?.["canonical-name"]).toBe(
			"STD_OBJ_COUNT",
		);
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture("7.25-getall-13-4-sessions.json");
		expect(fixture.provenance.routeros_version).toBe("7.25");
		expect(fixture.records.length).toBe(1);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("three rows with schema-resolved transport + const fields", () => {
		const fields = sessionFields();
		const fixture = loadFixture("7.25-getall-13-4-sessions.json");
		const record = required(fixture.records[0], "bare-getall-reply");
		const entries = decodeFixtureEntries(record.hex);
		expect(record.from).toEqual([13, 4]);

		const rows = rowsOf(requiredEntry(entries, "0xfe0002", "STD_OBJS"));
		expect(rows.length).toBe(3);

		// Row ids ride 0xfe0001.
		expect(
			rows.map((r) => requiredEntry(r, "0xfe0001", "row-id").value),
		).toEqual([1, 2, 41]);

		// Transport triple across the observed rows (pinned, not const).
		expect(
			rows.map(
				(r) => requiredEntry(r, keyOf(fields, "transport"), "transport").value,
			),
		).toEqual([13, 9, 1]);
		// Const fields: 2 / 3 on every observed row.
		for (const row of rows) {
			expect(requiredEntry(row, keyOf(fields, "unknown-6"), "f6").value).toBe(
				2,
			);
			expect(requiredEntry(row, keyOf(fields, "unknown-8"), "f8").value).toBe(
				3,
			);
		}
		// f1 is a u32 login time on every row; f3 is present on rows
		// 0/2 and absent on row 1 (present-iff-addressed).
		for (const row of rows) {
			expect(findEntry(row, keyOf(fields, "login-time"))?.tcode).toBe("0x8");
		}
		expect(
			findEntry(required(rows[0], "row 0"), keyOf(fields, "peer-ipv4")),
		).toBeDefined();
		expect(
			findEntry(required(rows[1], "row 1"), keyOf(fields, "peer-ipv4")),
		).toBeUndefined();
		expect(
			findEntry(required(rows[2], "row 2"), keyOf(fields, "peer-ipv4")),
		).toBeDefined();

		// Envelope total matches the row count.
		expect(requiredEntry(entries, "0xfe0019", "STD_OBJ_COUNT").value).toBe(
			rows.length,
		);
	});

	test("multihold fixture hex re-decodes to the recorded entries offline", () => {
		for (const name of MULTIHOLD) {
			const fixture = loadFixture(name);
			expect(fixture.records.length).toBe(3);
			for (const record of fixture.records) {
				expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
			}
		}
	});

	test("A2 adds exactly the held row and A3 drops it, all versions", () => {
		for (const name of MULTIHOLD) {
			const fixture = loadFixture(name);
			const want = required(ROW_IDS[name], `${name} pinned row ids`);
			const legs = { a1: 0, a2: 1, a3: 2 } as const;
			for (const [leg, idx] of Object.entries(legs)) {
				const record = required(fixture.records[idx], `${name} ${leg}`);
				expect(record.from).toEqual([13, 4]);
				const entries = decodeFixtureEntries(record.hex);
				const rows = rowsOf(requiredEntry(entries, "0xfe0002", "STD_OBJS"));
				expect(
					rows.map((r) => requiredEntry(r, "0xfe0001", "row-id").value),
				).toEqual(want[leg as keyof typeof want]);
				expect(requiredEntry(entries, "0xfe0019", "STD_OBJ_COUNT").value).toBe(
					rows.length,
				);
			}
		}
	});

	test("f1 matches REST when to the exact second, all versions", () => {
		const fields = sessionFields();
		for (const name of MULTIHOLD) {
			const fixture = loadFixture(name);
			const when = required(WHEN[name], `${name} pinned whens`);
			// A2 holds every row id (A1 + B), so one leg covers the join.
			const record = required(fixture.records[1], `${name} A2`);
			const rows = rowsOf(
				requiredEntry(decodeFixtureEntries(record.hex), "0xfe0002", "STD_OBJS"),
			);
			for (const row of rows) {
				const id = requiredEntry(row, "0xfe0001", "row-id").value as number;
				const epoch = requiredEntry(row, keyOf(fields, "login-time"), "f1")
					.value as number;
				expect(utcOf(epoch)).toBe(required(when[id], `${name} row ${id} when`));
			}
		}
	});

	test("f3 is the peer quad iff REST shows an address; f4 is the transport", () => {
		const fields = sessionFields();
		for (const name of MULTIHOLD) {
			const fixture = loadFixture(name);
			const join = required(REST_JOIN[name], `${name} pinned REST join`);
			const record = required(fixture.records[1], `${name} A2`);
			const rows = rowsOf(
				requiredEntry(decodeFixtureEntries(record.hex), "0xfe0002", "STD_OBJS"),
			);
			for (const row of rows) {
				const id = requiredEntry(row, "0xfe0001", "row-id").value as number;
				const rest = required(join[id], `${name} row ${id} REST`);
				const f3 = findEntry(row, keyOf(fields, "peer-ipv4"));
				if (rest.address === null) {
					expect(f3).toBeUndefined();
				} else {
					expect(
						quadOf(required(f3, `${name} row ${id} f3`).value as number),
					).toBe(rest.address);
				}
				expect(requiredEntry(row, keyOf(fields, "transport"), "f4").value).toBe(
					required(VIA_F4[rest.via], `f4 for ${rest.via}`),
				);
				expect(requiredEntry(row, keyOf(fields, "username"), "f2").value).toBe(
					"admin",
				);
			}
		}
	});

	test("f5/f6/f8 stay constant: presence + value only, no decode", () => {
		const fields = sessionFields();
		for (const name of MULTIHOLD) {
			const fixture = loadFixture(name);
			for (const record of fixture.records) {
				const rows = rowsOf(
					requiredEntry(
						decodeFixtureEntries(record.hex),
						"0xfe0002",
						"STD_OBJS",
					),
				);
				for (const row of rows) {
					expect(
						requiredEntry(row, keyOf(fields, "unknown-5"), "f5").value,
					).toBe(false);
					expect(
						requiredEntry(row, keyOf(fields, "unknown-6"), "f6").value,
					).toBe(2);
					expect(
						requiredEntry(row, keyOf(fields, "unknown-8"), "f8").value,
					).toBe(3);
				}
			}
		}
	});
});
