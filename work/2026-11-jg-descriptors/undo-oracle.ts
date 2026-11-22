// cspell:ignore quickchr
/**
 * Time-boxed probe (step 4 optional): does the [17] undo history name the
 * native M2 request for changes made over REST/CLI?
 *
 *   bun undo-oracle.ts --quickchr <name> --out <dir> --allow-mutations --disposable
 *
 * A native session subscribes to [17]. centrs (REST) makes four changes on
 * menus that profiles/winbox-ipc/gui-handlers.yaml has no handler for, then
 * restores them. Each [17] notification row carries the CLI text (S9), its
 * inverse (Sa), the source (s8), and the native request (m1) and inverse
 * (m2). Output: <dir>/capture.jsonl (pump records) and <dir>/oracle.json
 * (one entry per history row: CLI -> route, command, typed keys).
 * Exploratory; nothing here is promoted into the profiles.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildRequest } from "../2026-10-chr-extraction/ws3c/probe.ts";
import { MessagePump } from "../2026-11-winbox-attributes/harness/pump.ts";
import { openSession } from "../2026-11-winbox-attributes/harness/session.ts";
import {
	requireMutationGate,
	resolveLabTarget,
} from "../2026-11-winbox-attributes/harness/target.ts";
import {
	decodeLetters,
	hexToBytes,
	type LetterMsg,
} from "./webfig/m2-letters.ts";

const argv = process.argv.slice(2);
const opt = (name: string) => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};
const machine = opt("--quickchr") ?? "";
const outDir = opt("--out") ?? "";
if (!machine || !outDir) {
	console.error(
		"usage: undo-oracle.ts --quickchr <name> --out <dir> --allow-mutations --disposable",
	);
	process.exit(2);
}
requireMutationGate(
	{
		allowMutations: argv.includes("--allow-mutations"),
		disposable: argv.includes("--disposable"),
	},
	"undo oracle probe",
);
mkdirSync(outDir, { recursive: true });
const target = resolveLabTarget(machine, {
	allowedVersions: ["7.25", "7.26beta4"],
});
const cap = join(outDir, "capture.jsonl");

function rest(cli: string[]): void {
	const r = Bun.spawnSync([
		"centrs",
		"execute",
		"--quickchr",
		machine,
		"--via",
		"rest-api",
		"--yes",
		"--json",
		"--",
		...cli,
	]);
	const ok = (JSON.parse(r.stdout.toString()) as { ok?: boolean }).ok;
	console.log(`oracle: ${ok ? "ok " : "ERR"} ${cli.join(" ")}`);
	if (!ok) throw new Error(`centrs failed: ${cli.join(" ")}`);
}

const CHANGES: string[][] = [
	["/ip/dns/set", "cache-size=4096"],
	["/snmp/set", "contact=m2ir-contact", "location=m2ir-lab"],
	[
		"/ip/firewall/address-list/add",
		"list=m2ir",
		"address=192.0.2.1",
		"comment=m2ir-a",
	],
	["/ip/firewall/address-list/set", '[find list="m2ir"]', "comment=m2ir-b"],
];
const RESTORE: string[][] = [
	["/ip/firewall/address-list/remove", '[find list="m2ir"]'],
	["/snmp/set", 'contact=""', 'location=""'],
	["/ip/dns/set", "cache-size=2048"],
];

const s = await openSession(
	target.host,
	target.port,
	target.user,
	target.pass,
	{ timeoutMs: 8000 },
);
const pump = new MessagePump(s.transport, {
	label: "A",
	onCapture: (r) => appendFileSync(cap, `${JSON.stringify(r)}\n`),
});
const rows: LetterMsg[] = [];
try {
	await pump.request(buildRequest([17], 0xfe0012, s.sourceId, 2, []), 2, 8000);
	for (const c of [...CHANGES, ...RESTORE]) {
		rest(c);
		const got = await pump.listenFor(
			(r) => JSON.stringify(r.from) === "[17]",
			3000,
			300,
		);
		for (const r of got) {
			if (JSON.stringify(r.from) !== "[17]") continue;
			const m = decodeLetters(hexToBytes(r.plaintextHex)).msg;
			rows.push(...((m["Mfe0002"] ?? []) as LetterMsg[]));
		}
	}
} finally {
	await pump.stop(s.close);
}

const oracle = rows
	.filter((r) => r["S9"] !== undefined)
	.map((r) => {
		const m1 = (r["m1"] ?? {}) as LetterMsg;
		const m2 = (r["m2"] ?? {}) as LetterMsg;
		const user = (m: LetterMsg) =>
			Object.fromEntries(
				Object.entries(m).filter(
					([k]) => !/^[a-zA-Z]ff/.test(k) && k !== "Uff0001",
				),
			);
		return {
			cli: r["S9"],
			inverse_cli: r["Sa"],
			source: r["s8"],
			m1_route: m1["Uff0001"],
			m1_cmd: m1["uff0007"],
			m1_fields: user(m1),
			m2_route: m2["Uff0001"],
			m2_cmd: m2["uff0007"],
			m2_fields: user(m2),
		};
	});
writeFileSync(
	join(outDir, "oracle.json"),
	`${JSON.stringify({ routeros_version: target.version, oracle }, null, "\t")}\n`,
);
for (const o of oracle) console.log(JSON.stringify(o));
