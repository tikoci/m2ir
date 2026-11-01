// User-family shapes replay (6.49.23 + 7.25 + 7.26beta4).
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (user-list-13-1,
// user-group-13-2, policy-catalog-13-3, unknown-13-5,
// user-prefs-13-6/13-7, unknown-13-8). The wire bytes live in
// fixtures/winbox-ipc/{6.49,7.25,7.26beta4}-user-family.json: GETALL /
// GETCOUNT / GETOBJ shapes plus [13,5] GET, [13,6]/[13,7] selector
// misses, and the [13,8] default row — sanitized from the queue-3 cap8
// manifests. ([13,9] legs live in the census fixtures; [13,4] in
// queue-1.)
//
// Shape-only for unmapped fields: the tests pin key sets, tcodes, and
// verbatim values, never semantic readings. Per-version counts only.
//
// Rule: expected names come from the YAML, never from hardcoded labels. The
// mini parser (./m2-replay.ts) is independent of the work/ harness decoder.

// cspell:ignore nosuchuser

import { describe, expect, test } from "bun:test";
import {
	decodeFixtureEntries,
	type FixtureEntry,
	findEntry,
	loadFixture,
	loadYamlDoc,
	required,
	requiredEntry,
	rowsOf,
} from "./m2-replay";

interface GuiHandlersDoc {
	handlers: Record<
		string,
		{
			"sys-to"?: number[];
			role?: string;
			fields?: {
				"namespace-user"?: Record<string, { name: string; tcode?: string }>;
				"namespace-session"?: Record<string, { name: string; tcode?: string }>;
			};
		}
	>;
}

const V6 = "6.49-user-family.json";
const V7 = ["7.25-user-family.json", "7.26beta4-user-family.json"] as const;
const ALL = [V6, ...V7] as const;

const UNKNOWNID = 0xfe0004;

function recordById(name: string, id: string) {
	const fixture = loadFixture(name);
	return required(
		fixture.records.find((r) => r.id === id),
		`${name} ${id}`,
	);
}

/** Non-SYS keys of a flat GETOBJ reply (the row field set). */
function flatFieldSet(entries: FixtureEntry[]): string[] {
	return entries
		.filter((e) => !e.key.startsWith("0xff"))
		.map((e) => e.key)
		.sort();
}

function rowFieldSet(row: FixtureEntry[]): string[] {
	return row.map((e) => e.key).sort();
}

describe("user-family replay", () => {
	test("schema binds the user-family entries + mapped field names", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const routes: [string, number[]][] = [
			["user-list-13-1", [13, 1]],
			["user-group-13-2", [13, 2]],
			["policy-catalog-13-3", [13, 3]],
			["unknown-13-5", [13, 5]],
			["user-prefs-13-6", [13, 6]],
			["user-prefs-13-7", [13, 7]],
			["unknown-13-8", [13, 8]],
		];
		for (const [entry, route] of routes) {
			expect(required(gui.handlers[entry], entry)["sys-to"]).toEqual(route);
		}
		const list = required(gui.handlers["user-list-13-1"], "user-list-13-1");
		const listUser = required(list.fields?.["namespace-user"], "13-1 user");
		expect(required(listUser["1"], "13-1 f1").name).toBe("username");
		expect(required(listUser["2"], "13-1 f2").name).toBe("group-id");
		const group = required(gui.handlers["user-group-13-2"], "user-group-13-2");
		const groupUser = required(group.fields?.["namespace-user"], "13-2 user");
		expect(required(groupUser["2"], "13-2 f2").name).toBe("policy-mask-a");
		expect(required(groupUser["3"], "13-2 f3").name).toBe("policy-mask-b");
		const catalog = required(
			gui.handlers["policy-catalog-13-3"],
			"policy-catalog-13-3",
		);
		const catalogUser = required(
			catalog.fields?.["namespace-user"],
			"13-3 user",
		);
		expect(required(catalogUser["2"], "13-3 f2").name).toBe("policy-name");
		expect(required(catalogUser["3"], "13-3 f3").name).toBe("access-class");
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		for (const name of ALL) {
			const fixture = loadFixture(name);
			expect(fixture.records.length).toBe(34);
			for (const record of fixture.records) {
				expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
			}
		}
	});

	test("[13,1] admin row: 15 keys on 7.x, 13 on v6, GETOBJ-flat", () => {
		for (const name of V7) {
			const rx = decodeFixtureEntries(
				recordById(name, "user-family-getall-13-1-rx").hex,
			);
			const rows = rowsOf(requiredEntry(rx, "0xfe0002", "STD_OBJS"));
			expect(rows.length).toBe(1);
			const row = required(rows[0], `${name} admin row`);
			expect(row.length).toBe(15);
			expect(requiredEntry(row, "0x000029", "0x29").value).toBe(600000);
			expect(requiredEntry(row, "0x00002a", "0x2a").value).toBe(0);
			expect(requiredEntry(row, "0x00000b", "0x0b").value).toBe(655358);
			expect(requiredEntry(row, "0x000001", "username").value).toBe("admin");
			expect(requiredEntry(row, "0x000002", "group-id").value).toBe(3);
			// GETOBJ-flat: same field set as the GETALL row.
			const flat = decodeFixtureEntries(
				recordById(name, "user-family-getobj-13-1-1-rx").hex,
			);
			expect(findEntry(flat, "0xfe0002")).toBeUndefined();
			expect(flatFieldSet(flat)).toEqual(rowFieldSet(row));
		}
		const v6rx = decodeFixtureEntries(
			recordById(V6, "user-family-getall-13-1-rx").hex,
		);
		const v6rows = rowsOf(requiredEntry(v6rx, "0xfe0002", "STD_OBJS"));
		expect(v6rows.length).toBe(1);
		const v6row = required(v6rows[0], "v6 admin row");
		expect(v6row.length).toBe(13);
		expect(findEntry(v6row, "0x000029")).toBeUndefined();
		expect(findEntry(v6row, "0x00002a")).toBeUndefined();
		expect(requiredEntry(v6row, "0x00000b", "0x0b").value).toBe(393214);
		const v6flat = decodeFixtureEntries(
			recordById(V6, "user-family-getobj-13-1-1-rx").hex,
		);
		expect(findEntry(v6flat, "0xfe0002")).toBeUndefined();
		expect(flatFieldSet(v6flat)).toEqual(rowFieldSet(v6row));

		// GETCOUNT total 1 in the version slot; obj=999 misses clean.
		const v6count = decodeFixtureEntries(
			recordById(V6, "user-family-getcount-13-1-rx").hex,
		);
		expect(requiredEntry(v6count, "0xfe0014", "STD_COUNT").value).toBe(1);
		for (const name of V7) {
			const count = decodeFixtureEntries(
				recordById(name, "user-family-getcount-13-1-rx").hex,
			);
			expect(requiredEntry(count, "0xfe0019", "STD_OBJ_COUNT").value).toBe(1);
		}
		for (const name of ALL) {
			const miss = decodeFixtureEntries(
				recordById(name, "user-family-getobj-13-1-999-rx").hex,
			);
			expect(requiredEntry(miss, "0xff0008", "SYS_ERRNO").value).toBe(
				UNKNOWNID,
			);
			expect(findEntry(miss, "0xfe0019")).toBeUndefined();
			expect(findEntry(miss, "0xfe0014")).toBeUndefined();
		}
	});

	test("[13,1] 0x1f is volatile u32 across versions", () => {
		const seen = new Set<number>();
		for (const name of ALL) {
			const rx = decodeFixtureEntries(
				recordById(name, "user-family-getall-13-1-rx").hex,
			);
			const rows = rowsOf(requiredEntry(rx, "0xfe0002", "STD_OBJS"));
			const f = requiredEntry(
				required(rows[0], `${name} row`),
				"0x00001f",
				"0x1f",
			);
			expect(f.tcode).toBe("0x8");
			seen.add(f.value as number);
		}
		// Three captures, three distinct values (no reading claimed).
		expect(seen.size).toBe(3);
	});

	test("[13,2] masks differ by version; GETOBJ-flat; total 3", () => {
		const masks7: [string, number, number][] = [
			["read", 654958, 400],
			["write", 655086, 272],
			["full", 655358, 0],
		];
		for (const name of V7) {
			const rx = decodeFixtureEntries(
				recordById(name, "user-family-getall-13-2-rx").hex,
			);
			const rows = rowsOf(requiredEntry(rx, "0xfe0002", "STD_OBJS"));
			expect(rows.length).toBe(3);
			for (const [group, a, b] of masks7) {
				const row = rows.find((r) => findEntry(r, "0x000001")?.value === group);
				const found = required(row, `${name} ${group} row`);
				expect(requiredEntry(found, "0x000002", "mask-a").value).toBe(a);
				expect(requiredEntry(found, "0x000003", "mask-b").value).toBe(b);
				expect(requiredEntry(found, "0xfe000d", "0xfe000d").value).toBe(true);
				expect(requiredEntry(found, "0x000004", "f4").value).toBe(true);
				expect(requiredEntry(found, "0x000005", "f5").value).toBe(0);
			}
			const flat = decodeFixtureEntries(
				recordById(name, "user-family-getobj-13-2-1-rx").hex,
			);
			expect(findEntry(flat, "0xfe0002")).toBeUndefined();
			const read = required(
				rows.find((r) => findEntry(r, "0x000001")?.value === "read"),
				`${name} read row`,
			);
			expect(flatFieldSet(flat)).toEqual(rowFieldSet(read));
		}
		const v6rx = decodeFixtureEntries(
			recordById(V6, "user-family-getall-13-2-rx").hex,
		);
		const v6rows = rowsOf(requiredEntry(v6rx, "0xfe0002", "STD_OBJS"));
		expect(v6rows.length).toBe(3);
		const masks6: [string, number, number][] = [
			["read", 392814, 131472],
			["write", 392942, 131344],
			["full", 393214, 131072],
		];
		for (const [group, a, b] of masks6) {
			const row = required(
				v6rows.find((r) => findEntry(r, "0x000001")?.value === group),
				`v6 ${group} row`,
			);
			expect(requiredEntry(row, "0x000002", "mask-a").value).toBe(a);
			expect(requiredEntry(row, "0x000003", "mask-b").value).toBe(b);
		}
		const v6flat = decodeFixtureEntries(
			recordById(V6, "user-family-getobj-13-2-1-rx").hex,
		);
		expect(findEntry(v6flat, "0xfe0002")).toBeUndefined();
		const v6read = required(
			v6rows.find((r) => findEntry(r, "0x000001")?.value === "read"),
			"v6 read row",
		);
		expect(flatFieldSet(v6flat)).toEqual(rowFieldSet(v6read));

		const v6count = decodeFixtureEntries(
			recordById(V6, "user-family-getcount-13-2-rx").hex,
		);
		expect(requiredEntry(v6count, "0xfe0014", "STD_COUNT").value).toBe(3);
		for (const name of V7) {
			const count = decodeFixtureEntries(
				recordById(name, "user-family-getcount-13-2-rx").hex,
			);
			expect(requiredEntry(count, "0xfe0019", "STD_OBJ_COUNT").value).toBe(3);
		}
		for (const name of ALL) {
			const miss = decodeFixtureEntries(
				recordById(name, "user-family-getobj-13-2-999-rx").hex,
			);
			expect(requiredEntry(miss, "0xff0008", "SYS_ERRNO").value).toBe(
				UNKNOWNID,
			);
			expect(findEntry(miss, "0xfe0019")).toBeUndefined();
			expect(findEntry(miss, "0xfe0014")).toBeUndefined();
		}
	});

	test("[13,3] catalog: 17 rows on 7.x, 18 on v6, f3 per policy", () => {
		// id -> [name, f3]; descriptions pinned separately below.
		const catalog7: [number, string, number][] = [
			[1, "local", 1],
			[2, "telnet", 1],
			[3, "ssh", 1],
			[4, "ftp", 0],
			[5, "reboot", 0],
			[6, "read", 0],
			[7, "write", 0],
			[8, "policy", 0],
			[9, "test", 0],
			[10, "winbox", 1],
			[11, "password", 0],
			[12, "web", 1],
			[13, "sniff", 0],
			[14, "sensitive", 0],
			[15, "api", 1],
			[16, "romon", 0],
			[19, "rest-api", 1],
		];
		for (const name of V7) {
			const rx = decodeFixtureEntries(
				recordById(name, "user-family-getall-13-3-rx").hex,
			);
			const rows = rowsOf(requiredEntry(rx, "0xfe0002", "STD_OBJS"));
			expect(rows.length).toBe(17);
			expect(requiredEntry(rx, "0xfe0019", "STD_OBJ_COUNT").value).toBe(17);
			for (const [id, policy, f3] of catalog7) {
				const row = required(
					rows.find((r) => findEntry(r, "0xfe0001")?.value === id),
					`${name} id ${id}`,
				);
				expect(requiredEntry(row, "0x000002", "policy-name").value).toBe(
					policy,
				);
				expect(requiredEntry(row, "0x000003", "access-class").value).toBe(f3);
			}
			const row1 = required(
				rows.find((r) => findEntry(r, "0xfe0001")?.value === 1),
				`${name} row 1`,
			);
			expect(requiredEntry(row1, "0x000001", "description").value).toBe(
				"login to the console from gui and serial",
			);
			const count = decodeFixtureEntries(
				recordById(name, "user-family-getcount-13-3-rx").hex,
			);
			expect(requiredEntry(count, "0xfe0019", "STD_OBJ_COUNT").value).toBe(17);
		}

		const v6rx = decodeFixtureEntries(
			recordById(V6, "user-family-getall-13-3-rx").hex,
		);
		const v6rows = rowsOf(requiredEntry(v6rx, "0xfe0002", "STD_OBJS"));
		expect(v6rows.length).toBe(18);
		expect(requiredEntry(v6rx, "0xfe0019", "STD_OBJ_COUNT").value).toBe(18);
		// ids 1-16 match 7.x per policy; 17=dude, 18=tikapp; no rest-api.
		for (const [id, policy, f3] of catalog7.filter(([id]) => id <= 16)) {
			const row = required(
				v6rows.find((r) => findEntry(r, "0xfe0001")?.value === id),
				`v6 id ${id}`,
			);
			expect(requiredEntry(row, "0x000002", "policy-name").value).toBe(policy);
			expect(requiredEntry(row, "0x000003", "access-class").value).toBe(f3);
		}
		const dude = required(
			v6rows.find((r) => findEntry(r, "0xfe0001")?.value === 17),
			"v6 id 17",
		);
		expect(requiredEntry(dude, "0x000002", "policy-name").value).toBe("dude");
		expect(requiredEntry(dude, "0x000003", "access-class").value).toBe(0);
		expect(requiredEntry(dude, "0x000001", "description").value).toBe(
			"connect to Dude",
		);
		const tikapp = required(
			v6rows.find((r) => findEntry(r, "0xfe0001")?.value === 18),
			"v6 id 18",
		);
		expect(requiredEntry(tikapp, "0x000002", "policy-name").value).toBe(
			"tikapp",
		);
		expect(requiredEntry(tikapp, "0x000003", "access-class").value).toBe(1);
		expect(requiredEntry(tikapp, "0x000001", "description").value).toBe(
			"connect to the router via Tik-App",
		);
		expect(
			v6rows.some((r) => findEntry(r, "0x000002")?.value === "rest-api"),
		).toBe(false);
		const v6row1 = required(
			v6rows.find((r) => findEntry(r, "0xfe0001")?.value === 1),
			"v6 row 1",
		);
		expect(requiredEntry(v6row1, "0x000001", "description").value).toBe(
			"login to the router from console",
		);
		const v6count = decodeFixtureEntries(
			recordById(V6, "user-family-getcount-13-3-rx").hex,
		);
		expect(requiredEntry(v6count, "0xfe0014", "STD_COUNT").value).toBe(18);
	});

	test("[13,5] shape identical on all versions, f3 trails SYS keys", () => {
		const expected: [string, string, unknown][] = [
			["0x000005", "0x88", []],
			["0x000001", "0x0", false],
			["0x000002", "0x1", true],
			["0x000004", "0x9", 1],
			["0x000003", "0x9", 0],
		];
		for (const name of ALL) {
			const rx = decodeFixtureEntries(
				recordById(name, "user-family-get-13-5-bare-rx").hex,
			);
			expect(findEntry(rx, "0xff0008")).toBeUndefined();
			const user = rx.filter((e) => !e.key.startsWith("0xff"));
			expect(user.map((e) => e.key)).toEqual(expected.map(([k]) => k));
			for (const [key, tcode, value] of expected) {
				const entry = requiredEntry(rx, key, key);
				expect(entry.tcode).toBe(tcode);
				expect(entry.value).toEqual(value);
			}
			// f3 sorts after the SYS keys in reply order.
			const order = rx.map((e) => e.key);
			expect(order.indexOf("0x000003")).toBeGreaterThan(
				order.indexOf("0xff0006"),
			);
		}
	});

	test("[13,6]/[13,7] miss-is-empty 12/12 with genuine selectors", () => {
		const legs: [string, string][] = [
			["user-family-get-13-6-admin", "admin"],
			["user-family-get-13-6-nosuchuser", "nosuchuser-q3"],
			["user-family-get-13-7-admin", "admin"],
			["user-family-get-13-7-nosuchuser", "nosuchuser-q3"],
		];
		for (const name of ALL) {
			for (const [stem, selector] of legs) {
				const tx = decodeFixtureEntries(recordById(name, `${stem}-tx`).hex);
				expect(requiredEntry(tx, "0x000001", "selector").value).toBe(selector);
				const rx = decodeFixtureEntries(recordById(name, `${stem}-rx`).hex);
				expect(findEntry(rx, "0xff0008")).toBeUndefined();
				expect(rx.filter((e) => !e.key.startsWith("0xff"))).toEqual([]);
			}
		}
	});

	test("[13,8] default row + total 1, GETCOUNT in version slot", () => {
		for (const name of ALL) {
			const rx = decodeFixtureEntries(
				recordById(name, "user-family-getall-13-8-rx").hex,
			);
			const rows = rowsOf(requiredEntry(rx, "0xfe0002", "STD_OBJS"));
			expect(rows.length).toBe(1);
			const row = required(rows[0], `${name} default row`);
			expect(requiredEntry(row, "0xfe0001", "row-id").value).toBe(0);
			expect(requiredEntry(row, "0xfe0010", "name").value).toBe("default");
			expect(requiredEntry(rx, "0xfe0019", "STD_OBJ_COUNT").value).toBe(1);
		}
		const v6count = decodeFixtureEntries(
			recordById(V6, "user-family-getcount-13-8-rx").hex,
		);
		expect(requiredEntry(v6count, "0xfe0014", "STD_COUNT").value).toBe(1);
		for (const name of V7) {
			const count = decodeFixtureEntries(
				recordById(name, "user-family-getcount-13-8-rx").hex,
			);
			expect(requiredEntry(count, "0xfe0019", "STD_OBJ_COUNT").value).toBe(1);
		}
	});
});
