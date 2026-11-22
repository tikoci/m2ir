// cspell:ignore webfig refreshfilter quickchr
/**
 * Plan step 4: replay the step 3 Bridge workflow with the native WinBox
 * harness (two SRP sessions), and record what arrives unsolicited.
 *
 *   bun native-replay.ts --quickchr <name> --out <dir> --allow-mutations --disposable
 *
 * Session A is the listener (subscribes, reads). Session B is the "other
 * client": it changes comments, adds, moves and removes rows natively.
 * centrs (REST on v7, native API on 6.49) only creates the lab objects
 * (bridge m2ir-br, VLANs m2ir-vl1..3 on ether1, two ports) and removes
 * them at the end, while A listens.
 *
 * Questions (see README.md, "Native replay (plan step 4)"):
 *   q1 CMD_SUBSCRIBE 0xfe0012 + a change from B -> what A receives
 *   q2 GETALL with several 0xfe000c words -> row key sets
 *   q3 CMD_UNSUBSCRIBE 0xfe0013 -> do notifications stop
 *   q4 next-id chain (0xfe0005), MOVE 0xfe0007, removal rows
 *
 * Output: <dir>/capture.jsonl (every A/B message, full plaintext hex,
 * plus {"mark"} lines) and <dir>/meta.json. Plaintext holds no
 * credentials (SRP runs before the pump starts). Analysis is offline:
 * native-report.ts. Never runs in CI.
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type EncEntry,
	encStr,
	encU32,
	type M2Message,
} from "../2026-10-chr-extraction/ws3c/m2.ts";
import { buildRequest } from "../2026-10-chr-extraction/ws3c/probe.ts";
import {
	MessagePump,
	type PumpOutcome,
	type PumpRecord,
} from "../2026-11-winbox-attributes/harness/pump.ts";
import { openSession } from "../2026-11-winbox-attributes/harness/session.ts";
import {
	requireMutationGate,
	resolveLabTarget,
} from "../2026-11-winbox-attributes/harness/target.ts";

const CMD = {
	GETALL: 0xfe0004,
	SETOBJ: 0xfe0003,
	ADDOBJ: 0xfe0005,
	REMOVEOBJ: 0xfe0006,
	MOVEOBJ: 0xfe0007,
	NOTIFY: 0xfe000b,
	SUBSCRIBE: 0xfe0012,
	UNSUBSCRIBE: 0xfe0013,
} as const;
const IFACE = [20, 0];
const PORT = [16, 2];
const K = {
	id: 0xfe0001,
	next: 0xfe0005,
	comment: 0xfe0009,
	word: 0xfe000c,
	ifType: 0x10001,
	ifName: 0x10006,
	portIface: 3,
	portBridge: 4,
} as const;
/** 0xfe000c words: WebFig's two, the default, and the parts on their own. */
const WORDS_IFACE: Array<number | null> = [
	null,
	0,
	5,
	0x10000005,
	0x1004000f,
	0x4000a,
	0x2,
	0x8,
	0x40000,
];
const WORDS_PORT: Array<number | null> = [
	null,
	0,
	5,
	0x10000005,
	0x10000007,
	2,
];

function usage(): never {
	console.error(
		"usage: native-replay.ts --quickchr <name> --out <dir> --allow-mutations --disposable [--timeout <ms>]",
	);
	process.exit(2);
}

const argv = process.argv.slice(2);
let machine = "";
let outDir = "";
let allowMutations = false;
let disposable = false;
let timeoutMs = 8000;
for (let i = 0; i < argv.length; i++) {
	const t = argv[i];
	if (t === "--quickchr") machine = argv[++i] ?? "";
	else if (t === "--out") outDir = argv[++i] ?? "";
	else if (t === "--allow-mutations") allowMutations = true;
	else if (t === "--disposable") disposable = true;
	else if (t === "--timeout") timeoutMs = Number(argv[++i]);
	else usage();
}
if (!machine || !outDir) usage();
requireMutationGate({ allowMutations, disposable }, "step 4 native replay");
mkdirSync(outDir, { recursive: true });
const capPath = join(outDir, "capture.jsonl");
if (existsSync(capPath)) throw new Error(`refusing to overwrite ${capPath}`);

const target = resolveLabTarget(machine, {
	allowedVersions: ["7.25", "7.26beta4", "6.49.23"],
});
const v6 = target.version.startsWith("6.");
const via = v6 ? "native-api" : "rest-api";
console.log(
	`replay: ${machine} RouterOS ${target.version}, control via ${via}`,
);

const t0 = performance.now();
const clock = () => performance.now() - t0;
const write = (o: object) => appendFileSync(capPath, `${JSON.stringify(o)}\n`);
const mark = (name: string, extra: object = {}) => {
	const tMs = Math.round(clock() * 10) / 10;
	write({ mark: name, tMs, ...extra });
	console.log(`replay: [${tMs.toFixed(0)} ms] ${name}`);
};

// ── control plane (setup/cleanup only) ─────────────────────────────────
function control(cli: string[]): string {
	const r = Bun.spawnSync([
		"centrs",
		"execute",
		"--quickchr",
		machine,
		"--via",
		via,
		"--yes",
		"--json",
		// centrs validates with :parse first; the 6.49 CLI has no slash
		// paths, so the 6.49 run sends API words without that check.
		...(v6 ? ["--no-validate"] : []),
		"--",
		...cli,
	]);
	const out = r.stdout.toString();
	let ok = false;
	try {
		ok = (JSON.parse(out) as { ok?: boolean }).ok === true;
	} catch {
		ok = false;
	}
	write({ control: cli.join(" "), ok, tMs: Math.round(clock() * 10) / 10 });
	if (!ok)
		throw new Error(`control failed: ${cli.join(" ")}\n${out}${r.stderr}`);
	return out;
}
type CtlRow = Record<string, string>;
function controlRows(menu: string): CtlRow[] {
	const data = (JSON.parse(control([`${menu}/print`])) as { data?: unknown })
		.data;
	if (Array.isArray(data)) return data as CtlRow[];
	return data && typeof data === "object" && Object.keys(data).length > 0
		? [data as CtlRow]
		: [];
}
/** Remove the lab rows by .id (no [find]: the 6.49 native API has none). */
function cleanup(): void {
	const lab = (r: CtlRow) =>
		(r["comment"] ?? "").startsWith("m2ir") ||
		(r["name"] ?? "").startsWith("m2ir-");
	for (const menu of [
		"/interface/bridge/port",
		"/interface/vlan",
		"/interface/bridge",
	]) {
		try {
			for (const r of controlRows(menu).filter(lab))
				control([`${menu}/remove`, `numbers=${r[".id"]}`]);
		} catch (e) {
			console.error(`replay: cleanup ${menu} failed: ${(e as Error).message}`);
		}
	}
}

// ── native helpers ─────────────────────────────────────────────────────
interface NativeSession {
	pump: MessagePump;
	sourceId: number;
	reqId: number;
	close: () => void;
}
async function open(label: string): Promise<NativeSession> {
	const s = await openSession(
		target.host,
		target.port,
		target.user,
		target.pass,
		{
			timeoutMs,
		},
	);
	const pump = new MessagePump(s.transport, {
		label,
		clock,
		onCapture: (rec: PumpRecord) => write(rec),
	});
	return { pump, sourceId: s.sourceId, reqId: 1, close: s.close };
}
async function req(
	s: NativeSession,
	to: number[],
	cmd: number,
	extra: EncEntry[],
	note: string,
): Promise<PumpOutcome> {
	s.reqId += 1;
	const out = await s.pump.request(
		buildRequest(to, cmd, s.sourceId, s.reqId, extra),
		s.reqId,
		timeoutMs,
		note,
	);
	const st =
		out.status === "timeout"
			? "timeout"
			: `${out.status}${out.errno !== null ? ` errno=0x${out.errno.toString(16)}` : ""}${out.errstr ? ` "${out.errstr}"` : ""}`;
	console.log(`replay:   ${s.pump.label} ${note}: ${st}`);
	return out;
}
function rows(out: PumpOutcome): M2Message[] {
	if (out.status === "timeout") return [];
	const e = out.reply.entries.find((x) => x.fullKey === 0xfe0002);
	return Array.isArray(e?.value) ? (e.value as M2Message[]) : [];
}
function val(row: M2Message, key: number): unknown {
	return row.entries.find((e) => e.fullKey === key)?.value;
}
const isNotify = (path: number[]) => (r: PumpRecord) =>
	r.cmd === CMD.NOTIFY && JSON.stringify(r.from) === JSON.stringify(path);
function summarize(label: string, recs: PumpRecord[]): void {
	const parts = recs.map(
		(r) =>
			`cmd=${r.cmd === null ? "-" : `0x${r.cmd.toString(16)}`} from=${JSON.stringify(r.from)} to=${JSON.stringify(r.to)}`,
	);
	console.log(
		`replay:   ${label}: ${recs.length} unsolicited ${parts.join("; ")}`,
	);
	write({
		unsolicited: label,
		count: recs.length,
		records: recs.map((r) => `${r.session}${r.seq}`),
	});
}
const getall = (
	s: NativeSession,
	path: number[],
	word: number | null,
	note: string,
) =>
	req(s, path, CMD.GETALL, word === null ? [] : [encU32(K.word, word)], note);

// ── run ────────────────────────────────────────────────────────────────
const meta: Record<string, unknown> = {
	machine,
	routeros_version: target.version,
	control_via: via,
	started: new Date().toISOString(),
	words_iface: WORDS_IFACE,
	words_port: WORDS_PORT,
};
let A: NativeSession | null = null;
let B: NativeSession | null = null;
const others: NativeSession[] = [];
try {
	mark("setup");
	cleanup();
	control(["/interface/bridge/add", "name=m2ir-br"]);
	for (const n of [1, 2, 3]) {
		control([
			"/interface/vlan/add",
			`name=m2ir-vl${n}`,
			`vlan-id=${3990 + n}`,
			"interface=ether1",
		]);
	}
	for (const n of [1, 2]) {
		control([
			"/interface/bridge/port/add",
			"bridge=m2ir-br",
			`interface=m2ir-vl${n}`,
			"comment=m2ir-setup",
		]);
	}
	A = await open("A");
	B = await open("B");
	meta["source_ids"] = { A: A.sourceId, B: B.sourceId };

	// q1: subscribe both paths, read them like WebFig, then change from B.
	mark("q1-subscribe");
	await req(A, IFACE, CMD.SUBSCRIBE, [], "SUBSCRIBE [20,0]");
	const ifAll = await getall(A, IFACE, 0x1004000f, "GETALL [20,0] 0x1004000f");
	await req(A, PORT, CMD.SUBSCRIBE, [], "SUBSCRIBE [16,2]");
	const portAll = await getall(A, PORT, 0x10000007, "GETALL [16,2] 0x10000007");
	const ifRows = rows(ifAll);
	const idOfName = (name: string): number => {
		const r = ifRows.find((x) => val(x, K.ifName) === name);
		const id = r ? val(r, K.id) : undefined;
		if (typeof id !== "number") throw new Error(`no [20,0] row named ${name}`);
		return id;
	};
	const br = idOfName("m2ir-br");
	const vl = [1, 2, 3].map((n) => idOfName(`m2ir-vl${n}`));
	const portOf = (ifaceId: number, from: PumpOutcome = portAll): number => {
		const r = rows(from).find((x) => val(x, K.portIface) === ifaceId);
		const id = r ? val(r, K.id) : undefined;
		if (typeof id !== "number")
			throw new Error(`no [16,2] row for iface ${ifaceId}`);
		return id;
	};
	const p1 = portOf(vl[0] as number);
	const p2 = portOf(vl[1] as number);
	meta["lab_rows"] = { bridge: br, vlans: vl, ports: [p1, p2] };
	mark("q1-quiet", { windowMs: 2500 });
	summarize("q1-quiet", await A.pump.listen(2500));

	mark("q1-bridge-comment");
	await req(
		B,
		IFACE,
		CMD.SETOBJ,
		[encU32(K.id, br), encStr(K.comment, "m2ir-n1")],
		"SETOBJ bridge comment",
	);
	summarize(
		"q1-bridge-comment A",
		await A.pump.listenFor(isNotify(IFACE), 3000, 700),
	);
	summarize("q1-bridge-comment B", B.pump.drain());

	mark("q1-port-comment");
	await req(
		B,
		PORT,
		CMD.SETOBJ,
		[encU32(K.id, p1), encStr(K.comment, "m2ir-n2")],
		"SETOBJ port comment",
	);
	summarize(
		"q1-port-comment A",
		await A.pump.listenFor(isNotify(PORT), 3000, 700),
	);
	summarize("q1-port-comment B", B.pump.drain());

	mark("q1-self-change");
	await req(
		A,
		PORT,
		CMD.SETOBJ,
		[encU32(K.id, p2), encStr(K.comment, "m2ir-self")],
		"A SETOBJ own port comment",
	);
	summarize(
		"q1-self-change A",
		await A.pump.listenFor(isNotify(PORT), 3000, 700),
	);

	// q2: 0xfe000c words.
	mark("q2-words");
	for (const w of WORDS_IFACE)
		await getall(
			A,
			IFACE,
			w,
			`GETALL [20,0] ${w === null ? "no word" : `0x${w.toString(16)}`}`,
		);
	for (const w of WORDS_PORT)
		await getall(
			A,
			PORT,
			w,
			`GETALL [16,2] ${w === null ? "no word" : `0x${w.toString(16)}`}`,
		);
	summarize("q2-words A", A.pump.drain());

	// q3: unsubscribe.
	mark("q3-unsub-iface");
	await req(A, IFACE, CMD.UNSUBSCRIBE, [], "UNSUBSCRIBE [20,0]");
	await req(
		B,
		IFACE,
		CMD.SETOBJ,
		[encU32(K.id, br), encStr(K.comment, "m2ir-n3")],
		"SETOBJ bridge comment",
	);
	summarize("q3-after-unsub-iface A", await A.pump.listen(3000));
	mark("q3-port-still-subscribed");
	await req(
		B,
		PORT,
		CMD.SETOBJ,
		[encU32(K.id, p1), encStr(K.comment, "m2ir-n4")],
		"SETOBJ port comment",
	);
	summarize(
		"q3-port-still A",
		await A.pump.listenFor(isNotify(PORT), 3000, 700),
	);
	mark("q3-unsub-port");
	await req(A, PORT, CMD.UNSUBSCRIBE, [], "UNSUBSCRIBE [16,2]");
	await req(
		B,
		PORT,
		CMD.SETOBJ,
		[encU32(K.id, p1), encStr(K.comment, "m2ir-n5")],
		"SETOBJ port comment",
	);
	summarize("q3-after-unsub-port A", await A.pump.listen(3000));
	mark("q3-resubscribe");
	await req(A, IFACE, CMD.SUBSCRIBE, [], "SUBSCRIBE [20,0] again");
	await req(A, PORT, CMD.SUBSCRIBE, [], "SUBSCRIBE [16,2] again");
	await req(
		B,
		PORT,
		CMD.SETOBJ,
		[encU32(K.id, p1), encStr(K.comment, "m2ir-n6")],
		"SETOBJ port comment",
	);
	summarize(
		"q3-resubscribed A",
		await A.pump.listenFor(isNotify(PORT), 3000, 700),
	);
	// q3c: subscription bookkeeping on a fresh session C (A stays at one
	// plain subscription per path). One B change per rung; count what C gets.
	const C = await open("C");
	others.push(C);
	let n = 10;
	const rung = async (name: string, step: () => Promise<unknown>) => {
		mark(`q3c-${name}`);
		await step();
		await req(
			B as NativeSession,
			PORT,
			CMD.SETOBJ,
			[encU32(K.id, p1), encStr(K.comment, `m2ir-n${n++}`)],
			"SETOBJ port comment",
		);
		summarize(
			`q3c-${name} C`,
			await C.pump.listenFor(isNotify(PORT), 2500, 700),
		);
		summarize(`q3c-${name} A`, (A as NativeSession).pump.drain());
	};
	const sub = (word: number | null) => () =>
		req(
			C,
			PORT,
			CMD.SUBSCRIBE,
			word === null ? [] : [encU32(K.word, word)],
			`C SUBSCRIBE [16,2]${word === null ? "" : ` 0x${word.toString(16)}`}`,
		);
	const unsub =
		(word: number | null = null) =>
		() =>
			req(
				C,
				PORT,
				CMD.UNSUBSCRIBE,
				word === null ? [] : [encU32(K.word, word)],
				`C UNSUBSCRIBE [16,2]${word === null ? "" : ` 0x${word.toString(16)}`}`,
			);
	await rung("1-sub", sub(null));
	await rung("2-sub-again", sub(null));
	await rung("3-unsub", unsub());
	await rung("4-unsub-again", unsub());
	await rung("5-sub-word", sub(0x10000007));
	await rung("6-sub-plain", sub(null));
	await rung("7-unsub", unsub());
	await rung("8-unsub-again", unsub());
	await rung("9-unsub-word", unsub(0x10000007));
	await rung("10-unsub-word-again", unsub(0x10000007));
	await rung("11-sub-word-again", sub(0x10000007));
	await rung("12-close-session", async () => {
		await C.pump.stop(C.close);
		others.splice(others.indexOf(C), 1);
	});

	// q4: ordering and removal on the ordered map [16,2].
	mark("q4-chain");
	await getall(A, PORT, 0x10000007, "GETALL [16,2] two ports");
	mark("q4-add");
	const add = await req(
		B,
		PORT,
		CMD.ADDOBJ,
		[
			encU32(K.portIface, vl[2] as number),
			encU32(K.portBridge, br),
			encStr(K.comment, "m2ir-add"),
		],
		"ADDOBJ port m2ir-vl3",
	);
	let p3: number | null = null;
	if (add.status === "ok") {
		const id = add.reply.entries.find((e) => e.fullKey === K.id)?.value;
		p3 = typeof id === "number" ? id : null;
	}
	if (p3 === null) {
		// A timed-out ADDOBJ may still have created the row: look first, so
		// the control add never duplicates a port (RouterOS rejects that).
		// Only a successful read with usable rows can say "absent".
		const check = await getall(
			A,
			PORT,
			0x10000007,
			"GETALL [16,2] after ADDOBJ without id",
		);
		if (check.status !== "ok")
			throw new Error(`port lookup after ADDOBJ failed: ${check.status}`);
		if (!check.reply.entries.some((e) => e.fullKey === 0xfe0002))
			throw new Error("port lookup after ADDOBJ: reply has no rows key");
		const hit = rows(check).find((r) => val(r, K.portIface) === vl[2]);
		if (hit) {
			const id = val(hit, K.id);
			if (typeof id !== "number")
				throw new Error("port row for m2ir-vl3 has no 0xfe0001 id");
			p3 = id;
		}
	}
	if (p3 === null) {
		write({
			note: "native ADDOBJ gave no row id and no row exists; adding the port via control",
		});
		control([
			"/interface/bridge/port/add",
			"bridge=m2ir-br",
			"interface=m2ir-vl3",
			"comment=m2ir-setup",
		]);
	}
	summarize("q4-add A", await A.pump.listenFor(isNotify(PORT), 3000, 700));
	const after = await getall(A, PORT, 0x10000007, "GETALL [16,2] three ports");
	if (p3 === null) p3 = portOf(vl[2] as number, after);
	const order = (o: PumpOutcome) =>
		rows(o)
			.map((r) => `${val(r, K.id)}>${val(r, K.next) ?? "-"}`)
			.join(",");
	console.log(`replay:   order id>next: ${order(after)}`);
	meta["ports"] = { p1, p2, p3 };

	mark("q4-move-before-first");
	await req(
		B,
		PORT,
		CMD.MOVEOBJ,
		[encU32(K.id, p3), encU32(K.next, p1)],
		"MOVEOBJ p3 before p1",
	);
	summarize("q4-move A", await A.pump.listenFor(isNotify(PORT), 3000, 700));
	console.log(
		`replay:   order id>next: ${order(await getall(A, PORT, 0x10000007, "GETALL [16,2] after move"))}`,
	);
	const ctl = controlRows("/interface/bridge/port").map((r) => ({
		id: r[".id"],
		nextid: r[".nextid"],
		comment: r["comment"],
	}));
	write({ control_read: "port order", data: ctl });
	console.log(`replay:   control order: ${JSON.stringify(ctl)}`);

	mark("q4-move-to-end");
	await req(
		B,
		PORT,
		CMD.MOVEOBJ,
		[encU32(K.id, p3), encU32(K.next, 0xffffffff)],
		"MOVEOBJ p3 to end",
	);
	summarize("q4-move-end A", await A.pump.listenFor(isNotify(PORT), 3000, 700));
	console.log(
		`replay:   order id>next: ${order(await getall(A, PORT, 0x10000007, "GETALL [16,2] after move to end"))}`,
	);

	mark("q4-move-rowid-only");
	await req(B, PORT, CMD.MOVEOBJ, [encU32(K.id, p3)], "MOVEOBJ p3 rowid only");
	summarize("q4-move-rowid-only A", await A.pump.listen(2000));
	console.log(
		`replay:   order id>next: ${order(await getall(A, PORT, 0x10000007, "GETALL [16,2] after rowid-only move"))}`,
	);

	mark("q4-remove-port");
	await req(B, PORT, CMD.REMOVEOBJ, [encU32(K.id, p3)], "REMOVEOBJ p3");
	summarize("q4-remove A", await A.pump.listenFor(isNotify(PORT), 3000, 700));

	mark("q4-remove-bridge-with-ports");
	await req(
		B,
		IFACE,
		CMD.REMOVEOBJ,
		[encU32(K.id, br)],
		"REMOVEOBJ bridge (ports attached)",
	);
	summarize(
		"q4-remove-bridge A",
		await A.pump.listenFor(isNotify(IFACE), 3000, 1500),
	);
	await getall(A, PORT, 0x10000007, "GETALL [16,2] after bridge removal");

	mark("final-quiet", { windowMs: 5000 });
	summarize("final-quiet A", await A.pump.listen(5000));
	summarize("final-quiet B", B.pump.drain());
} finally {
	mark("cleanup");
	cleanup();
	if (A) summarize("cleanup A", await A.pump.listen(1500));
	for (const s of [A, B, ...others]) {
		if (!s) continue;
		await s.pump.stop(s.close);
		if (s.pump.error)
			console.error(`replay: ${s.pump.label} reader: ${s.pump.error.message}`);
	}
	meta["finished"] = new Date().toISOString();
	writeFileSync(
		join(outDir, "meta.json"),
		`${JSON.stringify(meta, null, "\t")}\n`,
	);
	console.log(`replay: capture in ${capPath}`);
}
