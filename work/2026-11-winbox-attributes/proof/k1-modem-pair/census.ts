// cspell:ignore getall getone getobj getcount hscan getobjbare getf7 rowid
// K1 read-only census (Phase K, modem-pair leg): copy of J1 census.ts
// extended with --f7 for the [20,61] f7-selector read-only variant
// matrix (GET with request field 7 string variants). GETONE + gating
// matrix (GETALL/GETOBJ/GETCOUNT) per route, lossless jsonl. No
// SET/ADD/REMOVE path exists in this script (0w by construction).
// The [20,61] private verb is NOT reachable from this script (static
// + dispatch evidence only, never sent live).
//
// Usage:
//   bun census.ts --quickchr <name> --allowed-version <v> --out <step.jsonl> --route 20,107 [--verbs getone,getall,getobj,getobjbare,getcount,getf7] [--obj <n>] [--f7 <s>...] [--timeout <ms>]
//   bun census.ts --host <h> --port <p> --user <u> --pass <pw> --out <step.jsonl> --route 20,61 [...]   (explicit target, e.g. v6 without REST)

import {
	type EncEntry,
	encStr,
	encU32,
} from "../../../2026-10-chr-extraction/ws3c/m2.ts";
import {
	buildRequest,
	CMD_GET,
	CMD_GETALL,
	CMD_GETOBJ,
} from "../../../2026-10-chr-extraction/ws3c/probe.ts";
import { appendCapture, type CaptureRecord } from "../../harness/capture.ts";
import {
	correlatedRequest,
	nextReqId,
} from "../../harness/correlate.ts";
import { openSession } from "../../harness/session.ts";
import { resolveLabTarget } from "../../harness/target.ts";

const CMD_GETCOUNT = 0xfe0015;

function usage(): never {
	console.error(
		"usage: census.ts (--quickchr <name> [--allowed-version <v>] | --host <h> --port <p> --user <u> --pass <pw>) --out <jsonl> --route <pid,hid>... [--verbs getone,getall,getobj,getobjbare,getcount,getf7] [--obj <n>] [--f7 <s>...] [--timeout <ms>]",
	);
	process.exit(2);
}

const VERBS: Record<string, { cmd: number; extra: () => EncEntry[] }> = {
	getone: { cmd: CMD_GET, extra: () => [] },
	getall: { cmd: CMD_GETALL, extra: () => [] },
	getobj: { cmd: CMD_GETOBJ, extra: () => [] },
	getobjbare: { cmd: CMD_GETOBJ, extra: () => [] },
	getcount: { cmd: CMD_GETCOUNT, extra: () => [] },
	getf7: { cmd: CMD_GET, extra: () => [] },
};

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	let machine = "";
	let allowedVersion = "";
	let host = "";
	let port = 0;
	let user = "";
	let pass = "";
	let explicit = false;
	let out = "";
	let timeoutMs = 8000;
	let objId = 1;
	let verbs = ["getone", "getall", "getobj", "getcount"];
	const f7Values: string[] = [];
	const routes: number[][] = [];
	for (let i = 0; i < argv.length; i++) {
		const t = argv[i] ?? "";
		if (t === "--quickchr") machine = argv[++i] ?? "";
		else if (t === "--allowed-version") allowedVersion = argv[++i] ?? "";
		else if (t === "--host") {
			host = argv[++i] ?? "";
			explicit = true;
		} else if (t === "--port") port = Number(argv[++i] ?? "0");
		else if (t === "--user") user = argv[++i] ?? "";
		else if (t === "--pass") pass = argv[++i] ?? "";
		else if (t === "--out") out = argv[++i] ?? "";
		else if (t === "--timeout") timeoutMs = Number(argv[++i] ?? "8000");
		else if (t === "--obj") objId = Number(argv[++i] ?? "1");
		else if (t === "--f7") {
			const v = argv[++i];
			if (v === undefined) usage();
			f7Values.push(v);
		}
		else if (t === "--verbs") verbs = (argv[++i] ?? "").split(",");
		else if (t === "--route") {
			const parts = (argv[++i] ?? "").split(",").map(Number);
			if (parts.length !== 2 || parts.some((n) => !Number.isInteger(n)))
				usage();
			routes.push(parts as number[]);
		} else usage();
	}
	if (!out || routes.length === 0) usage();
	if (!Number.isInteger(objId) || objId < 0) usage();
	if (!explicit && !machine) usage();
	if (explicit && (!host || !port || !user)) usage();
	for (const v of verbs) {
		if (!VERBS[v]) {
			console.error(`census: unknown verb ${v}`);
			usage();
		}
	}
	if (verbs.includes("getf7") && f7Values.length === 0) {
		console.error("census: verb getf7 needs at least one --f7 <s>");
		usage();
	}

	const target = explicit
		? { host, port, user, pass }
		: resolveLabTarget(machine, {
				allowedVersions: allowedVersion ? [allowedVersion] : undefined,
			});
	const captures: CaptureRecord[] = [];
	const onCapture = (rec: CaptureRecord): void => {
		rec.seq = captures.length;
		captures.push(rec);
		appendCapture(out, { ...rec, ts: "redacted" });
	};
	const session = await openSession(target.host, target.port, target.user, target.pass, {
		timeoutMs,
	});
	let reqId = 1;
	try {
		for (const route of routes) {
			for (const verb of verbs) {
				const def = VERBS[verb] as { cmd: number; extra: () => EncEntry[] };
				const variants: { label: string; extra: EncEntry[] }[] =
					verb === "getobj"
						? [{ label: verb, extra: [encU32(0xfe0001, objId)] }]
						: verb === "getf7"
							? f7Values.map((s) => ({
									label: `${verb} f7=${JSON.stringify(s)}`,
									extra: [encStr(7, s)],
								}))
							: [{ label: verb, extra: def.extra() }];
				for (const variant of variants) {
					reqId = nextReqId(reqId);
					try {
						const res = await correlatedRequest(
							session.transport,
							buildRequest(route, def.cmd, session.sourceId, reqId, variant.extra),
							reqId,
							{ timeoutMs, onCapture },
						);
						if (res.status === "ok") {
							const n = res.reply.entries.length;
							console.log(
								`census [${route}] ${variant.label}: ok fields=${n} statusWord=${String(res.statusWord)}`,
							);
						} else if (res.status === "router-error") {
							console.log(
								`census [${route}] ${variant.label}: ROUTER-ERROR errno=${res.errno} errstr=${JSON.stringify(res.errstr)}`,
							);
						} else {
							console.log(`census [${route}] ${variant.label}: ${res.status}`);
						}
					} catch (e) {
						console.log(
							`census [${route}] ${variant.label}: THREW ${(e as Error).message}`,
						);
					}
				}
			}
		}
		console.log(`census: records=${captures.length} out=${out}`);
	} finally {
		session.close();
	}
}

if (import.meta.main) {
	main().catch((e: unknown) => {
		console.error(`census: ${(e as Error).message}`);
		process.exit(1);
	});
}
