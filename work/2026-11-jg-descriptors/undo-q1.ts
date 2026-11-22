// cspell:ignore quickchr
/**
 * Plan step 4b, question 1: reversibility and noise of the [17] undo
 * history.
 *
 *   bun undo-q1.ts --quickchr <name> --out <dir> [--cap-writes 1200] --allow-mutations --disposable
 *
 * A native session A subscribes to [17]. centrs (REST) then:
 *   q1-noop-*    SETs a value to what it already is (singleton, table row)
 *   q1-real-set  one real SET, then [17] peek-undo (0x80007)
 *   q1-undo-*    native undo (0x80001) / redo (0x80002), REST /undo, /redo;
 *                each followed by a REST read of the value
 *   q1-table-*   address-list add, comment set, undo of both
 *   q1-cap       --cap-writes alternating native SETs on [34] (snmp
 *                location), then a second session B subscribes (replay?),
 *                pages GETALL [17] and counts REST /system/history
 *   q1-replay-*  A closes; C subscribes alone (replay?), then D while C
 *                is subscribed
 * Everything is restored at the end. Output: <dir>/capture.jsonl (pump
 * records with mark), <dir>/q1.json (per-step rows and reads).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encStr } from "../2026-10-chr-extraction/ws3c/m2.ts";
import {
	requireMutationGate,
	resolveLabTarget,
} from "../2026-11-winbox-attributes/harness/target.ts";
import { CMD_SET, centrsExec, UNDO_CMD, UndoListener } from "./undo-lib.ts";
import type { LetterMsg } from "./webfig/m2-letters.ts";

const argv = process.argv.slice(2);
const opt = (name: string) => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};
const machine = opt("--quickchr") ?? "";
const outDir = opt("--out") ?? "";
const capWrites = Number(opt("--cap-writes") ?? "1200");
if (!machine || !outDir) {
	console.error(
		"usage: undo-q1.ts --quickchr <name> --out <dir> [--cap-writes N] --allow-mutations --disposable",
	);
	process.exit(2);
}
requireMutationGate(
	{
		allowMutations: argv.includes("--allow-mutations"),
		disposable: argv.includes("--disposable"),
	},
	"undo q1 probe",
);
mkdirSync(outDir, { recursive: true });
const target = resolveLabTarget(machine, {
	allowedVersions: ["7.25", "7.26beta4"],
});
const cap = join(outDir, "capture.jsonl");
let mark = "q1-open";
const steps: Array<Record<string, unknown>> = [];

/** Row summary without the m1/m2 payloads (kept in capture.jsonl). */
const brief = (r: LetterMsg) =>
	Object.fromEntries(
		Object.entries(r).filter(([k]) => k !== "m1" && k !== "m2"),
	);

function rest(cli: string[]) {
	const r = centrsExec(machine, cli);
	console.log(`q1: ${r.ok ? "ok " : "ERR"} ${cli.join(" ")}`);
	return r;
}
const snmp = () => (rest(["/snmp/print"]).data ?? {}) as Record<string, string>;
const dnsCache = () =>
	(rest(["/ip/dns/print"]).data as Record<string, string>)["cache-size"];
const addrList = () =>
	(rest(["/ip/firewall/address-list/print", "where", "list=m2ir-q1"]).data ??
		[]) as Array<Record<string, string>>;

// SNMP baseline before any change: the finally block restores it exactly.
const snmpBaseRead = rest(["/snmp/print"]);
if (!snmpBaseRead.ok || !snmpBaseRead.data)
	throw new Error(`q1: cannot read the /snmp baseline: ${snmpBaseRead.error}`);
const snmpBase = snmpBaseRead.data as Record<string, string>;

const a = await UndoListener.open(target, "A", cap, () => mark);
let aOpen = true;

async function restoreState(): Promise<void> {
	mark = "q1-restore";
	try {
		const failures: string[] = [];
		const removed = rest([
			"/ip/firewall/address-list/remove",
			'[find list="m2ir-q1"]',
		]);
		if (!removed.ok)
			failures.push(`address-list removal failed: ${removed.error}`);
		// The restoration contract: a failed restore fails the probe.
		const restored = rest([
			"/snmp/set",
			`contact=${snmpBase["contact"] ?? ""}`,
			`location=${snmpBase["location"] ?? ""}`,
		]);
		if (!restored.ok) failures.push(`/snmp restore failed: ${restored.error}`);
		if (failures.length) throw new Error(`q1: ${failures.join("; ")}`);
	} finally {
		if (aOpen) await a.stop();
	}
}

try {
	const replay = await a.rows(2500, 500);
	steps.push({
		mark,
		replay_rows: replay.length,
		first: replay[0] ? brief(replay[0]) : null,
		last: replay.at(-1) ? brief(replay.at(-1) as LetterMsg) : null,
	});

	const step = async (m: string, fn: () => unknown, read?: () => unknown) => {
		mark = m;
		const res = await fn();
		const rows = await a.rows();
		const entry = {
			mark: m,
			result: res ?? null,
			rows: rows.map(brief),
			read: read ? read() : undefined,
		};
		steps.push(entry);
		console.log(`q1: ${m}: ${rows.length} rows`);
		return entry;
	};

	const snmp0 = snmp();
	const dns0 = dnsCache();
	await step(
		"q1-noop-dns",
		() => rest(["/ip/dns/set", `cache-size=${dns0}`]).ok,
		dnsCache,
	);
	await step(
		"q1-noop-snmp",
		() => rest(["/snmp/set", `contact=${snmp0["contact"] ?? ""}`]).ok,
	);
	await step(
		"q1-real-set",
		() => rest(["/snmp/set", "contact=m2ir-q1"]).ok,
		() => snmp()["contact"],
	);
	await step("q1-peek-undo", () => a.undoCmd(UNDO_CMD.peekUndo));
	await step("q1-peek-redo-empty", () => a.undoCmd(UNDO_CMD.peekRedo));
	await step(
		"q1-undo-native",
		() => a.undoCmd(UNDO_CMD.undo),
		() => snmp()["contact"],
	);
	await step("q1-peek-redo", () => a.undoCmd(UNDO_CMD.peekRedo));
	await step(
		"q1-redo-native",
		() => a.undoCmd(UNDO_CMD.redo),
		() => snmp()["contact"],
	);
	await step(
		"q1-undo-rest",
		() => rest(["/undo"]),
		() => snmp()["contact"],
	);
	await step(
		"q1-redo-rest",
		() => rest(["/redo"]),
		() => snmp()["contact"],
	);

	// Table: add, no-op comment, real comment, undo twice.
	await step(
		"q1-table-add",
		() =>
			rest([
				"/ip/firewall/address-list/add",
				"list=m2ir-q1",
				"address=192.0.2.10",
				"comment=m2ir-c1",
			]).ok,
		addrList,
	);
	await step(
		"q1-table-noop-comment",
		() =>
			rest([
				"/ip/firewall/address-list/set",
				'[find list="m2ir-q1"]',
				"comment=m2ir-c1",
			]).ok,
	);
	await step(
		"q1-table-comment",
		() =>
			rest([
				"/ip/firewall/address-list/set",
				'[find list="m2ir-q1"]',
				"comment=m2ir-c2",
			]).ok,
		addrList,
	);
	await step("q1-table-undo-comment", () => a.undoCmd(UNDO_CMD.undo), addrList);
	await step("q1-table-undo-add", () => a.undoCmd(UNDO_CMD.undo), addrList);
	await step("q1-table-redo-add", () => a.undoCmd(UNDO_CMD.redo), addrList);

	// Cap: many recorded writes (native SET [34] s3, fast), then count.
	mark = "q1-cap";
	const t0 = performance.now();
	let capErrors = 0;
	for (let i = 0; i < capWrites; i++) {
		const o = await a.write([34], CMD_SET, [encStr(3, `m2ir-cap-${i % 2}`)]);
		if (o !== "ok") capErrors++;
	}
	const capRows = await a.rows(3000, 1500);
	const removals = capRows.filter((r) => r["ufe0013"] !== undefined);
	steps.push({
		mark,
		writes: capWrites,
		write_errors: capErrors,
		seconds: Math.round((performance.now() - t0) / 100) / 10,
		live_rows_seen_by_A: capRows.length,
		removal_rows_seen_by_A: removals.length,
		first_removed: removals[0]?.["ufe0001"] ?? null,
		last_removed: removals.at(-1)?.["ufe0001"] ?? null,
	});
	mark = "q1-cap-second-subscriber";
	const b = await UndoListener.open(target, "B", cap, () => mark);
	try {
		const rep = await b.rows(3000, 1500);
		const ga = await b.getall();
		const hist = rest(["/system/history/print", "count-only"]).data;
		steps.push({
			mark,
			replay_rows_while_A_subscribed: rep.length,
			getall_total: ga.total,
			getall_pages: ga.pages,
			getall_rows: ga.ids.length,
			getall_id_min: Math.min(...ga.ids),
			getall_id_max: Math.max(...ga.ids),
			rest_history_count: hist,
		});
	} finally {
		await b.stop();
	}
	// Replay when no other session subscribes to [17].
	await a.stop();
	aOpen = false;
	mark = "q1-replay-alone";
	const c = await UndoListener.open(target, "C", cap, () => mark);
	try {
		const rep = await c.rows(4000, 2000);
		const ids = rep.map((r) => r["ufe0001"] as number);
		steps.push({
			mark,
			replay_rows: rep.length,
			replay_id_min: ids.length ? Math.min(...ids) : null,
			replay_id_max: ids.length ? Math.max(...ids) : null,
		});
		mark = "q1-replay-second";
		const d = await UndoListener.open(target, "D", cap, () => mark);
		try {
			const rep2 = await d.rows(4000, 1500);
			steps.push({ mark, replay_rows_while_C_subscribed: rep2.length });
		} finally {
			await d.stop();
		}
	} finally {
		await c.stop();
	}
} finally {
	await restoreState();
}
writeFileSync(
	join(outDir, "q1.json"),
	`${JSON.stringify({ machine, routeros_version: target.version, steps }, null, "\t")}\n`,
);
console.log(`q1: wrote ${join(outDir, "q1.json")}`);
