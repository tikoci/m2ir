// cspell:ignore quickchr
/**
 * Step 5 follow-up: why did WinBox 4.4 get a NOTIFY with every row 2-3 ms
 * after its first SUBSCRIBE of a path (README "WinBox 4 Bridge workflow",
 * open questions)? Each variant runs in a fresh native session and
 * replays one candidate prefix before SUBSCRIBE, then listens.
 *
 *   bun winbox4/first-notify.ts --quickchr twin3 --out <dir>
 *
 * v1-v11 vary what comes before SUBSCRIBE; e1-e10 vary SUBSCRIBE's own
 * envelope (WinBox sends it with no reply expected, 0xff0017=true and
 * 0xff0012=1000). Read-only (GETALL, GETPOLICIES, SUBSCRIBE, UNSUBSCRIBE). Output:
 * <dir>/capture.jsonl (every message, full plaintext hex) and a summary
 * line per variant on stdout. Never runs in CI.
 */
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
	decodeM2,
	type EncEntry,
	encBool,
	encodeM2,
	encU32,
	encU32Array,
	type M2Message,
} from "../../2026-10-chr-extraction/ws3c/m2.ts";
import { buildRequest } from "../../2026-10-chr-extraction/ws3c/probe.ts";
import {
	MessagePump,
	type PumpRecord,
} from "../../2026-11-winbox-attributes/harness/pump.ts";
import { openSession } from "../../2026-11-winbox-attributes/harness/session.ts";
import { resolveLabTarget } from "../../2026-11-winbox-attributes/harness/target.ts";

const CMD = {
	GETPOLICIES: 0xfe0001,
	GETALL: 0xfe0004,
	NOTIFY: 0xfe000b,
	SUBSCRIBE: 0xfe0012,
	UNSUBSCRIBE: 0xfe0013,
} as const;
const WORD = 0xfe000c;
const MAXOBJS = 0xfe0004;
/** WinBox 4.4's words (step 5 fixture). */
const PATHS: Array<{ path: number[]; word: number }> = [
	{ path: [16, 2], word: 0x10000007 },
	{ path: [20, 0], word: 0x1004000f },
];

/**
 * A step is a base command plus envelope modifiers joined with "+":
 *   defaults  GETALL 0xfe000c=0x20000000, 0xfe0004=0 (WinBox first open)
 *   getall    GETALL with the word
 *   policies  GETPOLICIES
 *   sub       SUBSCRIBE with the word      sub0  SUBSCRIBE without a word
 *   unsub     UNSUBSCRIBE with the word
 * Modifiers: nr = no SYS_REPLYEXP/SYS_REQID (WinBox sends SUBSCRIBE this
 * way), 17 = 0xff0017=true, 12 = 0xff0012=1000 (u32). "sub+nr+17+12" is
 * WinBox 4.4's first-open SUBSCRIBE; "sub+nr+12" its [16,2] reopen.
 */
type Step = string;
interface Variant {
	name: string;
	steps: Step[];
	/** FROM handler: "session" = adopted id, "own" = a per-path id like WinBox. */
	from: "session" | "own";
}
const VARIANTS: Variant[] = [
	{ name: "v1-sub", steps: ["sub"], from: "session" },
	{ name: "v2-pol-sub", steps: ["policies", "sub"], from: "session" },
	{ name: "v3-def-sub", steps: ["defaults", "sub"], from: "session" },
	{
		name: "v4-winbox",
		steps: ["defaults", "policies", "sub"],
		from: "session",
	},
	{
		name: "v5-winbox-own",
		steps: ["defaults", "policies", "sub"],
		from: "own",
	},
	{ name: "v6-def-only", steps: ["defaults"], from: "session" },
	{ name: "v7-def-sub0", steps: ["defaults", "sub0"], from: "session" },
	{
		name: "v8-def-getall-sub",
		steps: ["defaults", "getall", "sub"],
		from: "session",
	},
	{
		name: "v9-reopen",
		steps: ["defaults", "policies", "sub", "unsub", "sub"],
		from: "session",
	},
	{
		name: "v10-reopen-def",
		steps: ["defaults", "policies", "sub", "unsub", "defaults", "sub"],
		from: "session",
	},
	{ name: "v11-own-sub", steps: ["sub"], from: "own" },
	// Envelope variants (WinBox's SUBSCRIBE keys, one at a time).
	{ name: "e1-nr", steps: ["sub+nr"], from: "session" },
	{ name: "e2-nr17-12", steps: ["sub+nr+17+12"], from: "session" },
	{ name: "e3-nr12", steps: ["sub+nr+12"], from: "session" },
	{ name: "e4-nr17", steps: ["sub+nr+17"], from: "session" },
	{ name: "e5-req17", steps: ["sub+17"], from: "session" },
	{ name: "e6-req17-12", steps: ["sub+17+12"], from: "session" },
	{ name: "e7-sub0-17", steps: ["sub0+nr+17"], from: "session" },
	{
		name: "e8-unsub-sub17",
		steps: ["sub+nr+17+12", "unsub+nr+17+12", "sub+nr+17+12"],
		from: "session",
	},
	{
		name: "e9-again17",
		steps: ["sub+nr+17+12", "sub+nr+17+12"],
		from: "session",
	},
	{ name: "e10-getall17", steps: ["getall+17"], from: "session" },
];

const argv = process.argv.slice(2);
let machine = "";
let outDir = "";
for (let i = 0; i < argv.length; i++) {
	const t = argv[i];
	if (t === "--quickchr") machine = argv[++i] ?? "";
	else if (t === "--out") outDir = argv[++i] ?? "";
	else if (t !== "--envelope-only") {
		console.error(`unknown argument ${t}`);
		process.exit(2);
	}
}
if (!machine || !outDir) {
	console.error("usage: first-notify.ts --quickchr <name> --out <dir>");
	process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const capPath = join(outDir, "capture.jsonl");
if (existsSync(capPath)) throw new Error(`refusing to overwrite ${capPath}`);
const target = resolveLabTarget(machine, {
	allowedVersions: ["7.25", "7.26beta4", "6.49.23"],
});
const t0 = performance.now();
const clock = () => performance.now() - t0;
const write = (o: object) => appendFileSync(capPath, `${JSON.stringify(o)}\n`);
const hex = (n: number) => `0x${n.toString(16)}`;
function rowCount(m: M2Message | undefined): number | null {
	const e = m?.entries.find((x) => x.fullKey === 0xfe0002);
	return Array.isArray(e?.value) ? e.value.length : null;
}

async function run(v: Variant, p: { path: number[]; word: number }) {
	const s = await openSession(
		target.host,
		target.port,
		target.user,
		target.pass,
		{
			timeoutMs: 5000,
		},
	);
	const label = `${v.name}${JSON.stringify(p.path)}`;
	write({ mark: label, steps: v.steps, from: v.from, tMs: clock() });
	const pump = new MessagePump(s.transport, {
		label,
		clock,
		onCapture: (r: PumpRecord) => write(r),
	});
	const fromId = v.from === "own" ? s.sourceId + 40 : s.sourceId;
	let reqId = 1;
	const notes: string[] = [];
	for (const st of v.steps) {
		const [base, ...mods] = st.split("+");
		const noReply = mods.includes("nr");
		const [cmd, extra]: [number, EncEntry[]] =
			base === "defaults"
				? [CMD.GETALL, [encU32(WORD, 0x20000000), encU32(MAXOBJS, 0)]]
				: base === "getall"
					? [CMD.GETALL, [encU32(WORD, p.word)]]
					: base === "policies"
						? [CMD.GETPOLICIES, []]
						: base === "sub"
							? [CMD.SUBSCRIBE, [encU32(WORD, p.word)]]
							: base === "sub0"
								? [CMD.SUBSCRIBE, []]
								: [CMD.UNSUBSCRIBE, [encU32(WORD, p.word)]];
		if (mods.includes("17")) extra.push(encBool(0xff0017, true));
		if (mods.includes("12")) extra.push(encU32(0xff0012, 1000));
		let status: string;
		if (noReply) {
			await pump.send(
				encodeM2([
					encU32Array(0xff0001, p.path),
					encU32Array(0xff0002, [0, fromId]),
					encU32(0xff0007, cmd),
					...extra,
				]),
				st,
			);
			status = "sent";
		} else {
			reqId += 1;
			const out = await pump.request(
				buildRequest(p.path, cmd, fromId, reqId, extra),
				reqId,
				5000,
				st,
			);
			const rows = out.status === "timeout" ? null : rowCount(out.reply);
			status =
				out.status === "timeout"
					? "timeout"
					: `${out.status}${out.errno !== null ? ` errno=${hex(out.errno)}` : ""}${rows !== null ? ` rows=${rows}` : ""}`;
		}
		// Notifications that arrived while this step was pending, then a window.
		const unsolicited = [...pump.drain(), ...(await pump.listen(600))];
		const n = unsolicited.filter((r) => r.cmd === CMD.NOTIFY);
		const other = unsolicited.length - n.length;
		notes.push(
			`${st}:${status}${n.length ? ` NOTIFY×${n.length}(to=${JSON.stringify(n[0]?.to)} rows=${n.map((r) => rowCount(decodeM2(Buffer.from(r.plaintextHex, "hex")))).join(",")})` : ""}${other ? ` other×${other}` : ""}`,
		);
		write({ result: label, step: st, status, notify: n.length });
	}
	await pump.stop(s.close);
	console.log(
		`${label.padEnd(28)} from=${v.from.padEnd(7)} ${notes.join("  ")}`,
	);
}

console.log(`first-notify: ${machine} RouterOS ${target.version}`);
const only = argv.includes("--envelope-only");
for (const p of PATHS)
	for (const v of VARIANTS)
		if (!only || v.name.startsWith("e")) await run(v, p);
