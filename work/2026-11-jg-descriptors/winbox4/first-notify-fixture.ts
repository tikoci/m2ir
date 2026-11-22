// cspell:ignore quickchr
/**
 * Turn a first-notify.ts capture into the shared fixture
 * fixtures/winbox-ipc/<version>-native-subscribe-snapshot.json.
 *
 *   bun winbox4/first-notify-fixture.ts <capture-dir> <out.json> --version 7.25 [--entries-max <bytes>]
 *
 * Kept: every message. Each record carries mark (the variant and path,
 * e.g. "e2-nr17-12[16,2]"), session (the same label: every variant runs
 * in its own login) and tMs (ms since the probe started). Records over
 * --entries-max bytes (default 256) keep the hex with entries: null. No
 * hosts, ports or credentials: the plaintext starts after the SRP login.
 */
import { readFileSync, writeFileSync } from "node:fs";

interface Line {
	mark?: string;
	steps?: string[];
	from?: unknown;
	session?: string;
	seq?: number;
	direction?: "tx" | "rx";
	tMs?: number;
	reqId?: number | null;
	to?: number[] | null;
	cmd?: number | null;
	plaintextHex?: string;
	decode?: { ok: boolean; entries?: unknown[] };
	result?: string;
}

const args = process.argv.slice(2);
let entriesMax = 256;
let version = "";
const pos: string[] = [];
for (let i = 0; i < args.length; i++) {
	const a = args[i] ?? "";
	if (a === "--entries-max") entriesMax = Number(args[++i]);
	else if (a === "--version") version = args[++i] ?? "";
	else pos.push(a);
}
const [dir, out] = pos;
if (!dir || !out || !version) {
	console.error(
		"usage: first-notify-fixture.ts <capture-dir> <out.json> --version <v> [--entries-max <bytes>]",
	);
	process.exit(2);
}
const lines = readFileSync(`${dir}/capture.jsonl`, "utf8")
	.trim()
	.split("\n")
	.map((l) => JSON.parse(l) as Line);

const CMD: Record<number, string> = {
	16646145: "GETPOLICIES",
	16646148: "GETALL",
	16646155: "NOTIFY",
	16646162: "SUBSCRIBE",
	16646163: "UNSUBSCRIBE",
};
const variants: Record<string, { steps: string[]; from: unknown }> = {};
const records: Array<Record<string, unknown>> = [];
const t0 = lines.find((l) => typeof l.tMs === "number")?.tMs ?? 0;
for (const l of lines) {
	if (l.mark && l.steps) {
		variants[l.mark] = { steps: l.steps, from: l.from };
		continue;
	}
	if (!l.plaintextHex || !l.session) continue;
	if (!l.decode?.ok) throw new Error(`${l.session} ${l.seq}: undecodable`);
	const tx = l.direction === "tx";
	const name = (c: number | null | undefined) =>
		c == null ? "-" : (CMD[c] ?? `0x${c.toString(16)}`);
	const role = tx
		? `${name(l.cmd)} ${JSON.stringify(l.to)}, tx`
		: l.cmd === 0xfe000b
			? `unsolicited NOTIFY from ${JSON.stringify((l as { from?: unknown }).from)}`
			: `reply ${l.reqId ?? "-"}`;
	records.push({
		id: `${l.session}/${l.seq}`,
		role,
		source: `first-notify.ts ${l.session} seq ${l.seq}`,
		mark: l.session,
		session: l.session,
		tMs: Math.round(((l.tMs ?? 0) - t0) * 10) / 10,
		hex: l.plaintextHex,
		cmd: l.cmd ?? null,
		to: l.to ?? null,
		from: (l as { from?: unknown }).from ?? null,
		reqId: l.reqId ?? null,
		entries: l.plaintextHex.length / 2 > entriesMax ? null : l.decode.entries,
	});
}
const provenance = {
	report:
		"plan step 5 follow-up: what makes the router answer SUBSCRIBE with a NOTIFY of every row (work/2026-11-jg-descriptors/winbox4/first-notify.ts), 2026-11-22",
	routeros_version: version,
	packages: [`routeros ${version}, no extra packages`],
	route: [
		[16, 2],
		[20, 0],
	],
	variants,
	steps:
		"defaults = GETALL 0xfe000c=0x20000000 0xfe0004=0; policies = GETPOLICIES; getall = GETALL with the word; sub / unsub = SUBSCRIBE / UNSUBSCRIBE with the word ([16,2] 0x10000007, [20,0] 0x1004000f); sub0 = SUBSCRIBE without a word. Modifiers: nr = no SYS_REPLYEXP / SYS_REQID; 17 = 0xff0017=true; 12 = 0xff0012=1000 (u32). from own = FROM [0, source id + 40] instead of the adopted id.",
	sessions:
		"each variant and path is its own SRP login (session = mark); listen 600 ms after each step",
	lab_rows:
		"bridge m2ir-br with one port (m2ir-vl1, comment m2ir-r3) left from the step 5 recovery run",
	entries_max_bytes: entriesMax,
	note: "Sanitized M2 hex plus decoded entries only: no hosts, ports, credentials or wall-clock time (tMs is ms since the probe started). The plaintext starts after the SRP login.",
};
const body = records.map((r) => `\t\t${JSON.stringify(r)}`).join(",\n");
writeFileSync(
	out,
	`{\n\t"provenance": ${JSON.stringify(provenance)},\n\t"records": [\n${body}\n\t]\n}\n`,
);
console.log(`${out}: ${records.length} records`);
