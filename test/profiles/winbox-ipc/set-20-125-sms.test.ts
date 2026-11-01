// [20,125] /tool/sms native SET toggle replay (queue-2, 7.25 + 7.26beta4).
//
// The schema entries under test live in
// profiles/winbox-ipc/gui-handlers.yaml (sms-20-125 `set:`) and
// profiles/winbox-ipc/std-commands.yaml (0xfe000e CMD_SET). The wire bytes
// live in fixtures/winbox-ipc/{7.25,7.26beta4}-set-20-125-sms.json,
// sanitized from the queue-2 mutation capture batch (live CHR
// interrogation; independent REST /tool/sms tracked every step — the
// control reads are described in the schema notes, not replayed here).
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

interface FieldDef {
	name: string;
	tcode: string;
	access?: string;
	role?: string;
}

interface SmsDoc {
	handlers: Record<
		string,
		{
			"sys-to": number[];
			fields: { "namespace-user": Record<string, FieldDef> };
			set: {
				cmd: { value: number; name: string };
				scope: string;
				ack: string;
				versions: string[];
			};
			evidence: Array<{ ref: string }>;
		}
	>;
}

interface CommandsDoc {
	commands: Record<string, { "canonical-name"?: string; notes?: string }>;
}

const VERSIONS = ["7.25", "7.26beta4"] as const;
const BANNERS: Record<(typeof VERSIONS)[number], string> = {
	"7.25": "msg-proxy-7.25",
	"7.26beta4": "msg-proxy-7.26beta4",
};

function fixtureName(version: (typeof VERSIONS)[number]): string {
	return `${version}-set-20-125-sms.json`;
}

function smsEntry(): SmsDoc["handlers"][string] {
	const doc = loadYamlDoc<SmsDoc>("profiles/winbox-ipc/gui-handlers.yaml");
	return required(doc.handlers["sms-20-125"], "handlers.sms-20-125");
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

describe("sms [20,125] SET toggle replay", () => {
	test("schema carries the promoted [20,125] write mapping", () => {
		const sms = smsEntry();
		expect(sms["sys-to"]).toEqual([20, 125]);
		const fields = sms.fields["namespace-user"];
		expect(fields["7"]?.name).toBe("receive-enabled");
		expect(fields["7"]?.tcode).toBe("bool");
		expect(fields["7"]?.access).toBe("read-write");
		expect(fields["12"]?.name).toBe("channel");
		expect(fields["12"]?.tcode).toBe("u32");
		expect(fields["12"]?.access).toBe("read-write");
		// A UI write control is enabled exactly for read-write fields.
		// Queue-3 item 4 proved secret/sim-pin/port-ref/allowed-number/
		// sms-storage/polling/remove-sent writable and port-absent/
		// unknown-100/unknown-101 read-only (see set-20-125-map.test.ts
		// for the full access binding); field 9 now carries access.
		expect(fields["9"]?.access).toBe("read-write");

		expect(sms.set.cmd.value).toBe(0xfe000e);
		expect(sms.set.cmd.name).toBe("CMD_SET");
		expect(sms.set.versions).toContain("7.25");
		expect(sms.set.versions).toContain("7.26beta4");
		expect(sms.set.ack).toContain("0xff0006");

		const cmds = loadYamlDoc<CommandsDoc>(
			"profiles/winbox-ipc/std-commands.yaml",
		);
		const setEntry = required(cmds.commands[String(0xfe000e)], "CMD_SET");
		expect(setEntry["canonical-name"]).toBe("CMD_SET");
		expect(required(setEntry.notes, "CMD_SET notes")).toContain("[20,125]");

		const refs = sms.evidence.map((e) => e.ref).join("\n");
		expect(refs).toContain("set-20-125-sms.json");
	});

	test("fixture hex re-decodes to the recorded entries offline", () => {
		for (const version of VERSIONS) {
			const fixture = loadFixture(fixtureName(version));
			expect(fixture.records.length).toBe(12);
			for (const record of fixture.records) {
				expect(decodeFixtureEntries(record.hex)).toEqual(record.entries);
			}
		}
	});

	test("f07 moves both ways and alone on both versions", () => {
		for (const version of VERSIONS) {
			const fixture = loadFixture(fixtureName(version));
			const byId = new Map(fixture.records.map((r) => [r.id, r]));
			const decode = (id: string) =>
				decodeFixtureEntries(required(byId.get(id), id).hex);

			// SET requests carry the schema's set verb on the singleton route.
			for (const id of ["set-b-tx", "set-restore-tx"]) {
				const record = required(byId.get(id), id);
				expect(record.cmd).toBe(smsEntry().set.cmd.value);
				expect(record.to).toEqual([20, 125]);
			}
			// Singleton request: no selector, single USER field.
			const setB = decode("set-b-tx");
			expect(userEntries(setB).map((e) => e.key)).toEqual(["0x000007"]);
			expect(requiredEntry(setB, "0x000007", "f07").value).toBe(true);
			const setRestore = decode("set-restore-tx");
			expect(userEntries(setRestore).map((e) => e.key)).toEqual(["0x000007"]);
			expect(requiredEntry(setRestore, "0x000007", "f07").value).toBe(false);

			// Both-ways values through the schema-resolved field number.
			const sms = smsEntry();
			const f07key = "0x000007";
			expect(sms.fields["namespace-user"]["7"]?.name).toBe("receive-enabled");
			expect(
				requiredEntry(decode("baseline-get1-rx"), f07key, "f07").value,
			).toBe(false);
			expect(requiredEntry(decode("read-back-b-rx"), f07key, "f07").value).toBe(
				true,
			);
			expect(
				requiredEntry(decode("read-back-restore-rx"), f07key, "f07").value,
			).toBe(false);

			// Exactly one USER field moves each way (reqid echo aside).
			expect(
				changedKeys(decode("baseline-get1-rx"), decode("read-back-b-rx")),
			).toEqual(["0x000007", "0xff0006"]);
			expect(
				changedKeys(decode("read-back-b-rx"), decode("read-back-restore-rx")),
			).toEqual(["0x000007", "0xff0006"]);
			// The volatile check: two unchanged reads differ only in reqid echo.
			expect(
				changedKeys(decode("baseline-get1-rx"), decode("baseline-get2-rx")),
			).toEqual(["0xff0006"]);
		}
	});

	test("SET ack shape is bare SYS-only and differs only in reqid echo", () => {
		for (const version of VERSIONS) {
			const fixture = loadFixture(fixtureName(version));
			const byId = new Map(fixture.records.map((r) => [r.id, r]));
			const shapes: FixtureEntry[][] = [];
			for (const id of ["set-b-ack", "set-restore-ack"]) {
				const record = required(byId.get(id), id);
				const entries = decodeFixtureEntries(record.hex);
				// No USER-namespace payload, no errno, no statusWord carrier.
				expect(userEntries(entries)).toEqual([]);
				expect(findEntry(entries, "0xff0008")).toBeUndefined();
				expect(entries.map((e) => e.key)).toEqual([
					"0xff0001",
					"0xff0002",
					"0xff001c",
					"0xff0003",
					"0xff0006",
				]);
				expect(requiredEntry(entries, "0xff0001", "SYS_TO").value).toEqual([
					0, 11,
				]);
				expect(requiredEntry(entries, "0xff0002", "SYS_FROM").value).toEqual([
					20, 125,
				]);
				expect(requiredEntry(entries, "0xff001c", "banner").value).toEqual([
					BANNERS[version],
				]);
				expect(requiredEntry(entries, "0xff0003", "TYPE").value).toBe(2);
				expect(requiredEntry(entries, "0xff0006", "REQID").value).toBe(
					record.reqId,
				);
				shapes.push(entries);
			}
			// B ack vs restore ack: identical modulo the reqid echo byte.
			expect(
				changedKeys(shapes[0] as FixtureEntry[], shapes[1] as FixtureEntry[]),
			).toEqual(["0xff0006"]);
		}
	});

	test("no 7.25 to 7.26beta4 drift modulo the proxy banner", () => {
		const a = loadFixture(fixtureName("7.25"));
		const b = loadFixture(fixtureName("7.26beta4"));
		expect(a.records.map((r) => r.id)).toEqual(b.records.map((r) => r.id));
		for (const id of a.records.map((r) => r.id)) {
			const ra = required(
				a.records.find((r) => r.id === id),
				id,
			);
			const rb = required(
				b.records.find((r) => r.id === id),
				id,
			);
			if (id.endsWith("-tx")) {
				// Requests carry no banner: byte-identical across versions.
				expect(rb.hex).toBe(ra.hex);
			} else {
				// Replies differ only in the 0xff001c msg-proxy version string.
				expect(
					changedKeys(
						decodeFixtureEntries(ra.hex),
						decodeFixtureEntries(rb.hex),
					),
				).toEqual(["0xff001c"]);
			}
		}
	});
});
