// cspell:ignore webfig
/**
 * Build the sanitized [17] undo-history fixture (plan step 4b) from
 * undo-oracle.ts and undo-q1.ts captures.
 *
 *   bun undo-fixture.ts <out.json> <oracle-dir> <q1-dir>
 *
 * Kept: session A's SUBSCRIBE [17] and its reply, then for each mark in
 * KEEP every [17] message A received (CMD_NOTIFY rows, undo-command
 * replies). Large replays and GETALL pages are left out.
 *
 * Redaction (q2), applied to the decoded message, which is then
 * re-encoded (decodeM2 -> encodeM2 is byte-exact on every captured
 * message):
 * - source strings (row s8, m1/m2 SYS_ORIGINATOR text Sff001c):
 *   "<proto>:<user>@<address><rest>" -> "<proto>:<user>@<lab><rest>"
 * - credentials: in S9/Sa, the value of every SECRET_ARG property becomes
 *   <redacted>, and any string anywhere in the row equal to such a value
 *   is replaced the same way
 * - wall-clock time: history row u7 and the address-list creation time
 *   (ua on [20,35] and [20,48]) become 0
 * The builder then refuses to write if any string still holds an IPv4
 * address outside the documentation ranges, or a secret value.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
	decodeM2,
	encodeM2,
	type M2Entry,
	type M2Message,
} from "../2026-10-chr-extraction/ws3c/m2.ts";
import { losslessMessage } from "../2026-11-winbox-attributes/harness/capture.ts";
import { SECRET_ARG } from "./undo-menus.ts";

const [out, oracleDir, q1Dir] = process.argv.slice(2);
if (!out || !oracleDir || !q1Dir) {
	console.error("usage: undo-fixture.ts <out.json> <oracle-dir> <q1-dir>");
	process.exit(2);
}

/** Marks kept, per capture. */
const KEEP: Record<string, string[]> = {
	oracle: [
		"open",
		"/ip/dns set:cache-size",
		"/ip/dns set:cache-max-ttl",
		"/ip/dns set:query-server-timeout",
		"/ip/dns set:servers",
		"/ip/dns set:vrf",
		"/ip/settings set:icmp-rate-mask",
		"/ip/firewall/connection/tracking set:tcp-established-timeout",
		"/ip/neighbor/discovery-settings set:add-dns-entries-suffix",
		"/ip/neighbor/discovery-settings set:discover-interface-list",
		"/ip/neighbor/discovery-settings set:protocol",
		"/ip/firewall/address-list add",
		"/ip/firewall/address-list set:address",
		"/ip/firewall/address-list set:comment",
		"/ip/firewall/address-list remove",
		"/ipv6/firewall/address-list set:address",
		"/ip/pool set:ranges",
		"/queue/simple set:max-limit",
	],
	q1: [
		"q1-noop-dns",
		"q1-table-add",
		"q1-table-noop-comment",
		"q1-table-comment",
		"q1-table-undo-comment",
		"q1-table-undo-add",
		"q1-table-redo-add",
		"q1-peek-redo-empty",
	],
};
const TIME_KEYS: Record<string, number[]> = {
	"20,35": [0x0a],
	"20,48": [0x0a],
};
const SOURCE = /^([a-z-]+(?:\([a-z]+\))?:[^@\s]+@)([^/\s]+)(.*)$/;

type Line = {
	mark: string;
	session: string;
	seq: number;
	direction: "tx" | "rx";
	tMs: number;
	reqId: number | null;
	to: number[] | null;
	from: number[] | null;
	cmd: number | null;
	plaintextHex: string;
};

/** A nested M2 message (a Uint8Array also has an entries() method). */
const isMsg = (x: unknown): x is M2Message =>
	typeof x === "object" &&
	x !== null &&
	!(x instanceof Uint8Array) &&
	Array.isArray((x as M2Message).entries);

/** Secret values named in CLI text, and the text with them redacted. */
function redactCli(text: string, secrets: Set<string>): string {
	return text.replace(
		/([a-z0-9.-]+)=("(?:[^"\\]|\\.)*"|[^\s;]*)/g,
		(all, arg: string, raw: string) => {
			if (!SECRET_ARG.test(arg)) return all;
			const v = raw.startsWith('"') ? raw.slice(1, -1) : raw;
			if (v) secrets.add(v);
			return `${arg}=<redacted>`;
		},
	);
}

function sanitize(
	msg: M2Message,
	route: string,
	secrets: Set<string>,
): M2Message {
	const walkStrings = (e: M2Entry): M2Entry => {
		const fix = (s: string) => {
			if (secrets.has(s)) return "<redacted>";
			const m = SOURCE.exec(s);
			return m ? `${m[1]}<lab>${m[3]}` : s;
		};
		if (typeof e.value === "string") return { ...e, value: fix(e.value) };
		if (Array.isArray(e.value) && e.value.every((x) => typeof x === "string"))
			return { ...e, value: (e.value as string[]).map(fix) };
		if (Array.isArray(e.value) && e.value.length > 0 && e.value.every(isMsg))
			return {
				...e,
				value: (e.value as M2Message[]).map((m) => sanitize(m, route, secrets)),
			};
		if (isMsg(e.value)) {
			const inner = e.value as M2Message;
			const to = inner.entries.find((x) => x.fullKey === 0xff0001)?.value;
			const r = Array.isArray(to) ? (to as number[]).join(",") : route;
			return { ...e, value: sanitize(inner, r, secrets) };
		}
		return e;
	};
	// A history row (S9 string array + s8 source): redact the CLI text
	// first, so its secret values are known for the rest of the row.
	const isRow =
		msg.entries.some((e) => e.fullKey === 0x09 && e.tcode === 0xa0) &&
		msg.entries.some((e) => e.fullKey === 0x08 && typeof e.value === "string");
	if (isRow)
		for (const e of msg.entries)
			if ((e.fullKey === 0x09 || e.fullKey === 0x0a) && e.tcode === 0xa0)
				e.value = (e.value as string[]).map((t) => redactCli(t, secrets));
	return {
		entries: msg.entries.map((e) => {
			const x = walkStrings(e);
			if (isRow && x.fullKey === 0x07 && typeof x.value === "number")
				return { ...x, value: 0 };
			if (
				(TIME_KEYS[route] ?? []).includes(x.fullKey) &&
				typeof x.value === "number"
			)
				return { ...x, value: 0 };
			return x;
		}),
	};
}

/** Every string in a decoded message, for the final leak check. */
function strings(m: M2Message): string[] {
	return m.entries.flatMap((e) => {
		const v = e.value;
		if (typeof v === "string") return [v];
		if (Array.isArray(v))
			return (v as unknown[]).flatMap((x) =>
				typeof x === "string" ? [x] : isMsg(x) ? strings(x) : [],
			);
		if (isMsg(v)) return strings(v);
		return [];
	});
}
const DOC_V4 = /^(192\.0\.2|198\.51\.100|203\.0\.113|0\.0\.0)\./;

function fixValue(v: unknown): unknown {
	if (typeof v === "string" && v.startsWith("u64:")) return Number(v.slice(4));
	if (Array.isArray(v))
		return v.map((x) =>
			typeof x === "object" && x !== null && "key" in x
				? { ...x, value: fixValue((x as { value: unknown }).value) }
				: Array.isArray(x)
					? fixValue(x)
					: x,
		);
	return v;
}

const records: Array<Record<string, unknown>> = [];
const versions = new Set<string>();
// The machine name comes from the oracle run (undo-q1.ts runs on the same CHR).
const oracleMeta = JSON.parse(
	readFileSync(`${oracleDir}/meta.json`, "utf8"),
) as { machine: string };
for (const [label, dir] of [
	["oracle", oracleDir],
	["q1", q1Dir],
] as const) {
	const meta = JSON.parse(
		readFileSync(`${dir}/${label === "oracle" ? "meta" : "q1"}.json`, "utf8"),
	) as { routeros_version: string; machine?: string };
	versions.add(meta.routeros_version);
	const keep = new Set(KEEP[label]);
	const lines = readFileSync(`${dir}/capture.jsonl`, "utf8")
		.trim()
		.split("\n")
		.map((l) => JSON.parse(l) as Line);
	for (const l of lines) {
		if (!keep.has(l.mark) || l.session !== "A") continue;
		const isSubscribe = l.mark === "open" || l.mark === "q1-open";
		// "open": only the SUBSCRIBE and its reply (the replay is 100 rows).
		if (l.mark === "open" && !(l.reqId !== null && l.cmd !== 0xfe000b))
			continue;
		if (
			!isSubscribe &&
			l.direction === "tx" &&
			l.cmd !== 0x80001 &&
			l.cmd !== 0x80002 &&
			l.cmd !== 0x80008
		)
			continue;
		const secrets = new Set<string>();
		const msg = sanitize(
			decodeM2(new Uint8Array(Buffer.from(l.plaintextHex, "hex"))),
			"",
			secrets,
		);
		for (const s of strings(msg)) {
			const v4 = s.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
			const bad = v4.filter((a) => !DOC_V4.test(a));
			if (bad.length)
				throw new Error(`fixture: ${l.mark} keeps address ${bad.join(", ")}`);
			for (const x of secrets)
				if (s.includes(x)) throw new Error(`fixture: ${l.mark} keeps a secret`);
		}
		const bytes = encodeM2(msg.entries);
		const hex = Buffer.from(bytes).toString("hex");
		const kind =
			l.direction === "tx" ? "tx" : l.cmd === 0xfe000b ? "notify" : "reply";
		records.push({
			id: `${label}/${l.mark}/A${l.seq}`,
			role: `${l.mark} ${kind}`,
			source: `${meta.machine ?? oracleMeta.machine} ${meta.routeros_version} ${label === "oracle" ? "undo-oracle.ts" : "undo-q1.ts"} ${l.mark} session A seq ${l.seq}`,
			mark: l.mark,
			session: "A",
			tMs: l.tMs,
			hex,
			cmd: l.cmd,
			to: l.to,
			from: l.from,
			reqId: l.reqId,
			entries:
				bytes.length > 256
					? null
					: losslessMessage(msg).map((e) => ({
							...e,
							value: fixValue(e.value),
						})),
		});
	}
}
const provenance = {
	report:
		"plan step 4b [17] undo-history oracle (work/2026-11-jg-descriptors/undo-oracle.ts, undo-q1.ts), 2026-11-21",
	routeros_version: [...versions].join(", "),
	route: [17],
	sessions:
		"A: one native session subscribed to [17] (source id [0,11]); every change was made over REST by centrs (no-op SETs, documentation addresses), the undo/redo commands natively by A",
	redaction:
		"source strings '<proto>:<user>@<lab><rest>'; SECRET_ARG values -> <redacted> (none in the kept marks); history row u7 and address-list ua (creation time) -> 0. Messages re-encoded after redaction.",
	entries_max_bytes: 256,
	note: "Sanitized M2 hex plus decoded entries only: no hosts, ports, credentials or wall-clock time (tMs is ms since the run started). Large messages keep hex with entries: null.",
};
const body = records.map((r) => `\t\t${JSON.stringify(r)}`).join(",\n");
writeFileSync(
	out,
	`{\n\t"provenance": ${JSON.stringify(provenance)},\n\t"records": [\n${body}\n\t]\n}\n`,
);
console.log(`undo-fixture: ${records.length} records -> ${out}`);
