// [13,7] WebUserPrefs SET-overwrite replay (queue-3 item 3, 7.25 only).
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (user-prefs-13-7 role/set/notes),
// profiles/winbox-ipc/std-commands.yaml (CMD_SET third leg,
// CMD_DISCONNECTED trigger characterization), and
// profiles/winbox-ipc/std-errors.yaml (ERROR_FAILED write-path sample).
// The wire bytes live in
// fixtures/winbox-ipc/7.25-set-13-7-overwrite.json, sanitized from the
// queue-3 mutation capture batch (live CHR interrogation on twin3; every
// SET claim carries main-session GET read-back, fresh EC-SRP5 sessions on
// the create/overwrite/restore legs, and independent REST /user reads —
// the control reads are described in the schema notes, not replayed here).
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

interface CommandsDoc {
	commands: Record<string, { "canonical-name"?: string }>;
}

interface ErrorsDoc {
	errors: Record<string, { "canonical-name"?: string }>;
}

interface SysKeysDoc {
	keys: Record<
		string,
		{ "canonical-name"?: string; values?: Record<string, string> }
	>;
}

interface HandlersDoc {
	handlers: Record<
		string,
		{
			"sys-to"?: number[];
			fields?: { "namespace-user"?: Record<string, { name?: string }> };
		}
	>;
}

const FIXTURE = "7.25-set-13-7-overwrite.json";
const SELECTOR = "q3setprobe";

function commandName(cmd: number): string {
	const doc = loadYamlDoc<CommandsDoc>("profiles/winbox-ipc/std-commands.yaml");
	return required(
		doc.commands[String(cmd)]?.["canonical-name"],
		`commands[${cmd}]`,
	);
}

function errnoName(errno: number): string {
	const doc = loadYamlDoc<ErrorsDoc>("profiles/winbox-ipc/std-errors.yaml");
	return required(
		doc.errors[String(errno)]?.["canonical-name"],
		`errors[${errno}]`,
	);
}

function statusValue(name: string): number {
	const sys = loadYamlDoc<SysKeysDoc>("profiles/winbox-ipc/sys-keys.yaml");
	const values = required(
		sys.keys[String(0xff0004)]?.values,
		"SYS_STATUS values",
	);
	for (const [raw, label] of Object.entries(values)) {
		if (label === name) return Number(raw);
	}
	throw new Error(`no SYS_STATUS value named ${name}`);
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

describe("user-prefs [13,7] SET-overwrite replay", () => {
	test("schema binds the handler, verbs, and error names", () => {
		const handlers = loadYamlDoc<HandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		expect(handlers.handlers["user-prefs-13-7"]?.["sys-to"]).toEqual([13, 7]);
		expect(commandName(0xfe000d)).toBe("CMD_GET");
		expect(commandName(0xfe000e)).toBe("CMD_SET");
		expect(commandName(0xfe0014)).toBe("CMD_DISCONNECTED");
		expect(errnoName(0xfe0006)).toBe("ERROR_FAILED");
		expect(statusValue("ERROR")).toBe(2);
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		const fixture = loadFixture(FIXTURE);
		expect(fixture.records.length).toBe(54);
		for (const record of fixture.records) {
			expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
		}
	});

	test("empty SET is rejected with FAILED and changes nothing", () => {
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const decode = (id: string) =>
			decodeFixtureEntries(required(byId.get(id), id).hex);

		// The rejected SET carries zero USER fields (47B bare skeleton).
		expect(required(byId.get("set-a1-empty-set-tx"), "tx").hex.length / 2).toBe(
			47,
		);
		expect(userEntries(decode("set-a1-empty-set-tx"))).toEqual([]);

		// Rejection: FAILED + statusWord + the bare-selector errstr (101B).
		const rx = decode("set-a1-empty-set-rx");
		expect(required(byId.get("set-a1-empty-set-rx"), "rx").hex.length / 2).toBe(
			101,
		);
		expect(requiredEntry(rx, "0xff0008", "ERRNO").value).toBe(0xfe0006);
		expect(requiredEntry(rx, "0xff0004", "STATUS").value).toBe(
			statusValue("ERROR"),
		);
		expect(requiredEntry(rx, "0xff0009", "ERRSTR").value).toBe(
			"no user name provided",
		);

		// Zero state change: post-GET is the bare empty shape again.
		expect(userMap(decode("get-synthetic-selector-a1-empty-set-rx"))).toEqual(
			userMap(decode("pre-create-baseline-get-synthetic-selector-rx")),
		);

		// FAILED appears as an errno exactly once in these 54 records.
		let failed = 0;
		for (const record of fixture.records) {
			for (const entry of decodeFixtureEntries(record.hex)) {
				if (entry.key === "0xff0008") {
					expect(entry.value).toBe(0xfe0006);
					failed++;
				}
			}
		}
		expect(failed).toBe(1);
	});

	test("selector-only SET creates a key-only record", () => {
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const decode = (id: string) =>
			decodeFixtureEntries(required(byId.get(id), id).hex);

		expect(userEntries(decode("set-a2-key-only-set-tx"))).toEqual([
			{ key: "0x000001", tcode: "0x21", value: SELECTOR },
		]);
		// The read-back holds exactly f1: a create, not a no-op or delete.
		expect(
			userMap(decode("get-synthetic-selector-a2-key-only-set-rx")),
		).toEqual([["0x000001", JSON.stringify(SELECTOR)]]);
	});

	test("overwrite A-to-B moves exactly f2/f3 with reply order 3-1-2", () => {
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const decode = (id: string) =>
			decodeFixtureEntries(required(byId.get(id), id).hex);

		expect(userEntries(decode("set-a3-create-tx"))).toEqual([
			{ key: "0x000001", tcode: "0x21", value: SELECTOR },
			{ key: "0x000002", tcode: "0x21", value: "q3-blob-A" },
			{ key: "0x000003", tcode: "0x9", value: 7 },
		]);
		expect(userEntries(decode("set-a4-overwrite-tx"))).toEqual([
			{ key: "0x000001", tcode: "0x21", value: SELECTOR },
			{ key: "0x000002", tcode: "0x21", value: "q3-blob-B" },
			{ key: "0x000003", tcode: "0x9", value: 9 },
		]);

		// Overwrite proof: only f2/f3 move between the two read-backs.
		expect(
			changedKeys(
				decode("get-synthetic-selector-a3-create-rx"),
				decode("get-synthetic-selector-a4-overwrite-rx"),
			),
		).toEqual(["0x000002", "0x000003", "0xff0006"]);

		// Reply order on populated records is 3,1,2 (f3 first).
		for (const id of [
			"get-synthetic-selector-a3-create-rx",
			"get-synthetic-selector-a4-overwrite-rx",
		]) {
			expect(userEntries(decode(id)).map((e) => e.key)).toEqual([
				"0x000003",
				"0x000001",
				"0x000002",
			]);
		}

		// Fresh-session read-backs agree with the main session on USER state.
		expect(
			userMap(
				decode("get-synthetic-selector-a3-create-independent-session-rx"),
			),
		).toEqual(userMap(decode("get-synthetic-selector-a3-create-rx")));
		expect(
			userMap(
				decode("get-synthetic-selector-a4-overwrite-independent-session-rx"),
			),
		).toEqual(userMap(decode("get-synthetic-selector-a4-overwrite-rx")));
	});

	test("delete-via-SET is refuted: key-only is the minimal record", () => {
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const decode = (id: string) =>
			decodeFixtureEntries(required(byId.get(id), id).hex);

		// Both restore attempts reuse the a2 wire shape modulo the reqid byte.
		const normTx = (id: string) => {
			const hex = required(byId.get(id), id).hex;
			return `${hex.slice(0, 20)}RR${hex.slice(22)}`;
		};
		expect(normTx("set-a5-restore-empty-tx")).toBe(
			normTx("set-a2-key-only-set-tx"),
		);
		expect(normTx("set-a5-restore-retry-tx")).toBe(
			normTx("set-a2-key-only-set-tx"),
		);

		// Both attempts leave the key-only record, not empty.
		const keyOnly: Array<[string, string]> = [
			["0x000001", JSON.stringify(SELECTOR)],
		];
		expect(
			userMap(decode("get-synthetic-selector-a5-restore-empty-rx")),
		).toEqual(keyOnly);
		expect(
			userMap(decode("get-synthetic-selector-a5-restore-retry-rx")),
		).toEqual(keyOnly);
		expect(
			userMap(
				decode(
					"get-synthetic-selector-a5-restore-empty-independent-session-rx",
				),
			),
		).toEqual(keyOnly);
		expect(
			userMap(
				decode(
					"get-synthetic-selector-a5-restore-retry-independent-session-rx",
				),
			),
		).toEqual(keyOnly);

		// Grounded selectors stay pristine (empty) at the end.
		expect(userMap(decode("final-get-admin-untouched-probe-rx"))).toEqual([]);
		expect(
			userMap(decode("final-get-nosuchuser-q3-untouched-probe-rx")),
		).toEqual([]);
	});

	test("ok ack replies are bare SYS-only and match the empty-miss shape", () => {
		const fixture = loadFixture(FIXTURE);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const decode = (id: string) =>
			decodeFixtureEntries(required(byId.get(id), id).hex);

		const ackIds = [
			"set-a2-key-only-set-ack",
			"set-a3-create-ack",
			"set-a4-overwrite-ack",
			"set-a5-restore-empty-ack",
			"set-a5-restore-retry-ack",
		];
		// Bare SYS-only: no USER keys, no errno, no statusWord; 62B each.
		for (const id of ackIds) {
			const record = required(byId.get(id), id);
			expect(record.hex.length / 2).toBe(62);
			const entries = decode(id);
			expect(userEntries(entries)).toEqual([]);
			expect(findEntry(entries, "0xff0008")).toBeUndefined();
			expect(findEntry(entries, "0xff0004")).toBeUndefined();
			expect(requiredEntry(entries, "0xff0003", `${id} TYPE`).value).toBe(2);
		}
		// Identical modulo the final reqid byte; empty-miss replies match.
		const normRx = (id: string) => {
			const hex = required(byId.get(id), id).hex;
			return `${hex.slice(0, -2)}RR`;
		};
		const shape = normRx(ackIds[0] as string);
		for (const id of ackIds) expect(normRx(id)).toBe(shape);
		for (const id of [
			"recon-get-admin-1-rx",
			"recon-get-admin-2-rx",
			"recon-get-ws19u-rx",
			"recon-get-nosuchuser-q3-rx",
			"pre-create-baseline-get-synthetic-selector-rx",
			"get-synthetic-selector-a1-empty-set-rx",
		]) {
			expect(normRx(id)).toBe(shape);
		}
	});

	test("zombie pairs arrive once per closed session before the next reply", () => {
		const fixture = loadFixture(FIXTURE);
		const ids = fixture.records.map((r) => r.id);
		const byId = new Map(fixture.records.map((r) => [r.id, r]));
		const asyncIds = ids.filter((id) => id.startsWith("async-zombie-"));
		expect(asyncIds).toEqual([
			"async-zombie-slot518-leg-a",
			"async-zombie-slot518-leg-b",
			"async-zombie-slot774-leg-a",
			"async-zombie-slot774-leg-b",
			"async-zombie-slot1030-leg-a",
			"async-zombie-slot1030-leg-b",
			"async-zombie-slot1286-leg-a",
			"async-zombie-slot1286-leg-b",
		]);
		// Pair shape: leg A from the fabric pseudo-pid, leg B with policy -1.
		const slots = [518, 774, 1030, 1286];
		for (const slot of slots) {
			const legA = decodeFixtureEntries(
				required(byId.get(`async-zombie-slot${slot}-leg-a`), `leg-a`).hex,
			);
			const legB = decodeFixtureEntries(
				required(byId.get(`async-zombie-slot${slot}-leg-b`), `leg-b`).hex,
			);
			expect(requiredEntry(legA, "0xff0007", "CMD").value).toBe(0xfe0014);
			expect(requiredEntry(legB, "0xff0007", "CMD").value).toBe(0xfe0014);
			expect(requiredEntry(legA, "0xff0002", "FROM").value).toEqual([
				0xff0003,
				slot,
			]);
			expect(requiredEntry(legB, "0xff0002", "FROM").value).toEqual([2, slot]);
			expect(requiredEntry(legB, "0xff000b", "POLICY").value).toBe(0xffffffff);
			expect(userEntries(legA)).toEqual([]);
			expect(userEntries(legB)).toEqual([]);
		}
		// Each pair sits immediately before the reply to the first request
		// after a fresh-session close (reqIds 13/15/17/19).
		const follows: Array<[string, string]> = [
			["async-zombie-slot518-leg-b", "set-a4-overwrite-ack"],
			["async-zombie-slot774-leg-b", "set-a5-restore-empty-ack"],
			["async-zombie-slot1030-leg-b", "set-a5-restore-retry-ack"],
			["async-zombie-slot1286-leg-b", "final-get-admin-untouched-probe-rx"],
		];
		for (const [legB, next] of follows) {
			expect(ids[ids.indexOf(legB) + 1]).toBe(next);
		}
		// Negative control: reqId 20 (no close before it) draws no pair.
		const adminRx = ids.indexOf("final-get-admin-untouched-probe-rx");
		expect(ids.slice(adminRx)).toEqual([
			"final-get-admin-untouched-probe-rx",
			"final-get-nosuchuser-q3-untouched-probe-tx",
			"final-get-nosuchuser-q3-untouched-probe-rx",
		]);
	});

	test("tx verbs are GET/SET only, all routed to [13,7]", () => {
		const fixture = loadFixture(FIXTURE);
		let gets = 0;
		let sets = 0;
		for (const record of fixture.records) {
			if (!record.id.endsWith("-tx")) continue;
			expect(record.to).toEqual([13, 7]);
			if (record.cmd === 0xfe000d) gets++;
			else if (record.cmd === 0xfe000e) sets++;
			else throw new Error(`unexpected tx cmd ${record.cmd} (${record.id})`);
		}
		expect(gets).toBe(17);
		expect(sets).toBe(6);
	});
});
