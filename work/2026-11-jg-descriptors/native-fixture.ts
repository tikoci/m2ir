// cspell:ignore webfig
/**
 * Turn a native-replay.ts capture into a shared fixture in the
 * fixtures/winbox-ipc record shape (exact hex + decoded entries).
 *
 *   bun native-fixture.ts <capture-dir> <out.json> [--iface-words absent,0x2,...] [--entries-max <bytes>]
 *
 * Kept: every request, every unsolicited message, and every reply except
 * the large [20,0] GETALL replies: the q1 one (0x1004000f, the WebFig
 * word) stays, and q2 keeps only the words in --iface-words (default all).
 * Each record adds mark (the driver step), session (A listener, B other
 * client, C subscription probe) and tMs (ms since the run started; no
 * wall-clock time). Records whose plaintext exceeds --entries-max bytes
 * (default 256) keep the exact hex with entries: null, to keep the file
 * small; consumers decode the hex. No hosts, ports or credentials: the
 * plaintext starts after the SRP login. One record per line; biome's
 * formatter skips these files (biome.json override).
 */
import { readFileSync, writeFileSync } from "node:fs";

interface Entry {
	key: string;
	tcode: string;
	value: unknown;
}
interface Line {
	mark?: string;
	session?: string;
	seq?: number;
	direction?: "tx" | "rx";
	tMs?: number;
	reqId?: number | null;
	to?: number[] | null;
	from?: number[] | null;
	cmd?: number | null;
	plaintextHex?: string;
	decode?: { ok: boolean; entries?: Entry[]; error?: string };
}

const CMD_NAME: Record<number, string> = {
	16646147: "SETOBJ",
	16646148: "GETALL",
	16646149: "ADDOBJ",
	16646150: "REMOVEOBJ",
	16646151: "MOVEOBJ",
	16646155: "NOTIFY",
	16646162: "SUBSCRIBE",
	16646163: "UNSUBSCRIBE",
	16646164: "DISCONNECTED",
};

/** Capture values -> the fixture form decoded by test/.../m2-replay.ts. */
function fixValue(v: unknown): unknown {
	if (typeof v === "string" && v.startsWith("u64:")) {
		const n = Number(v.slice(4));
		if (!Number.isSafeInteger(n)) throw new Error(`u64 beyond safe int: ${v}`);
		return n;
	}
	if (Array.isArray(v)) {
		if (
			v.length > 0 &&
			Array.isArray(v[0]) &&
			typeof (v[0] as unknown[])[0] === "object"
		)
			return (v as Entry[][]).map((row) => row.map(fixEntry));
		if (
			v.length > 0 &&
			typeof v[0] === "object" &&
			v[0] !== null &&
			"key" in v[0]
		)
			return (v as Entry[]).map(fixEntry);
		return v.map(fixValue);
	}
	return v;
}
function fixEntry(e: Entry): Entry {
	return { key: e.key, tcode: e.tcode, value: fixValue(e.value) };
}

const args = process.argv.slice(2);
const wAt = args.indexOf("--iface-words");
const keepWords = wAt >= 0 ? new Set((args[wAt + 1] ?? "").split(",")) : null;
const eAt = args.indexOf("--entries-max");
const entriesMax = eAt >= 0 ? Number(args[eAt + 1]) : 256;
const optionValues = new Set(
	[wAt, eAt].filter((i) => i >= 0).map((i) => i + 1),
);
const [dir, out] = args.filter(
	(a, i) => !a.startsWith("--") && !optionValues.has(i),
);
if (!dir || !out) {
	console.error(
		"usage: native-fixture.ts <capture-dir> <out.json> [--iface-words absent,0x2,...]",
	);
	process.exit(2);
}
const meta = JSON.parse(readFileSync(`${dir}/meta.json`, "utf8")) as Record<
	string,
	unknown
>;
const lines = readFileSync(`${dir}/capture.jsonl`, "utf8")
	.trim()
	.split("\n")
	.map((l) => JSON.parse(l) as Line);

const word = (entries: Entry[]) => {
	const w = entries.find((e) => e.key === "0xfe000c")?.value;
	return typeof w === "number" ? `0x${w.toString(16)}` : "absent";
};
const txByReq = new Map<string, Line>();
let mark = "";
const records: Array<Record<string, unknown>> = [];
let dropped = 0;
for (const l of lines) {
	if (l.mark) {
		mark = l.mark;
		continue;
	}
	if (!l.plaintextHex || !l.session || !l.decode?.ok || !l.decode.entries)
		continue;
	const entries = l.decode.entries;
	const reqKey = `${l.session}/${l.reqId}`;
	let role: string;
	if (l.direction === "tx") {
		txByReq.set(reqKey, l);
		const w =
			l.cmd === 0xfe0004 || l.cmd === 0xfe0012 || l.cmd === 0xfe0013
				? ` 0xfe000c=${word(entries)}`
				: "";
		role = `${CMD_NAME[l.cmd ?? -1] ?? l.cmd} ${JSON.stringify(l.to)}${w}, tx`;
	} else if (l.reqId !== null && txByReq.has(reqKey)) {
		const tx = txByReq.get(reqKey) as Line;
		const txEntries = tx.decode?.entries ?? [];
		const w = tx.cmd === 0xfe0004 ? ` 0xfe000c=${word(txEntries)}` : "";
		if (
			tx.cmd === 0xfe0004 &&
			JSON.stringify(tx.to) === "[20,0]" &&
			mark === "q2-words" &&
			keepWords !== null &&
			!keepWords.has(word(txEntries))
		) {
			dropped++;
			continue;
		}
		role = `${CMD_NAME[tx.cmd ?? -1] ?? tx.cmd} ${JSON.stringify(tx.to)}${w}, reply`;
	} else {
		role = `unsolicited ${CMD_NAME[l.cmd ?? -1] ?? l.cmd} from ${JSON.stringify(l.from)}`;
	}
	records.push({
		id: `${mark}/${l.session}${l.seq}`,
		role,
		source: `${meta["machine"]} ${meta["routeros_version"]} native-replay ${mark} session ${l.session} seq ${l.seq}`,
		mark,
		session: l.session,
		tMs: l.tMs,
		hex: l.plaintextHex,
		cmd: l.cmd ?? null,
		to: l.to ?? null,
		from: l.from ?? null,
		reqId: l.reqId ?? null,
		entries:
			l.plaintextHex.length / 2 > entriesMax ? null : entries.map(fixEntry),
	});
}
const fixture = {
	provenance: {
		report:
			"plan step 4 native replay of the Bridge workflow (work/2026-11-jg-descriptors/native-replay.ts), 2026-11-21",
		routeros_version: meta["routeros_version"],
		route: [
			[20, 0],
			[16, 2],
		],
		sessions:
			"A listener (subscribes, reads); B other client (SETOBJ/ADDOBJ/MOVEOBJ/REMOVEOBJ); C subscription probe (q3c). All three share source id [0,11] on their own connections.",
		lab_rows: meta["lab_rows"],
		ports: meta["ports"],
		control: `centrs over ${meta["control_via"]}: setup (bridge m2ir-br, VLANs m2ir-vl1..3 vlan-id 3991..3993 on ether1, ports for vl1 and vl2) and cleanup only`,
		dropped_iface_getall_replies: dropped,
		entries_max_bytes: entriesMax,
		note: "Sanitized M2 hex plus decoded entries only: no hosts, ports, credentials or wall-clock time (tMs is ms since the run started). The plaintext starts after the SRP login. Machine name and version only; lab state is synthetic QEMU state.",
	},
	records,
};
const body = records.map((r) => `\t\t${JSON.stringify(r)}`).join(",\n");
writeFileSync(
	out,
	`{\n\t"provenance": ${JSON.stringify(fixture.provenance)},\n\t"records": [\n${body}\n\t]\n}\n`,
);
console.log(
	`fixture: ${records.length} records, ${dropped} [20,0] GETALL replies dropped -> ${out}`,
);
