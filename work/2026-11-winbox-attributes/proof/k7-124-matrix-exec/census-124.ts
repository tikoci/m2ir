// cspell:ignore getall getone getobj getcount hscan getobjbare rowid u32array veth ids
// K7 [20,124] selector-matrix leg (Phase K execution, 0w): J1 census.ts
// copy extended with request-extra flags for the K5 matrix (field 1005
// u32array + B1/B2/G6/G7b extras). One route/verb-set per invocation;
// lossless jsonl. No SET/ADD/REMOVE path exists in this script (0w by
// construction). Private cmds 1/2 are NOT expressible here (X2).
//
// Usage:
//   bun census-124.ts --quickchr <name> --allowed-version <v> --out <step.jsonl> --route 20,124 --verbs getcount [--ids 2] [--ids-field 1005] [--u32-1005 2] [--bool-1008 0] [--obj <n>] [--timeout <ms>]
//   --ids <csv>: encU32Array(ids-field, ids); --ids "" encodes an explicit empty array (G5)

import {
	type EncEntry,
	encBool,
	encU32,
	encU32Array,
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
		"usage: census-124.ts (--quickchr <name> [--allowed-version <v>] | --host <h> --port <p> --user <u> --pass <pw>) --out <jsonl> --route <pid,hid>... [--verbs getone,getall,getobj,getobjbare,getcount] [--obj <n>] [--ids <csv>] [--ids-field <n>] [--u32-1005 <n>] [--bool-1008 <0|1>] [--timeout <ms>]",
	);
	process.exit(2);
}

const VERBS: Record<string, { cmd: number; extra: () => EncEntry[] }> = {
	getone: { cmd: CMD_GET, extra: () => [] },
	getall: { cmd: CMD_GETALL, extra: () => [] },
	getobj: { cmd: CMD_GETOBJ, extra: () => [] },
	getobjbare: { cmd: CMD_GETOBJ, extra: () => [] },
	getcount: { cmd: CMD_GETCOUNT, extra: () => [] },
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
	let ids: number[] | null = null;
	let idsField = 1005;
	let u32single: number | null = null;
	let bool1008: boolean | null = null;
	let verbs = ["getone", "getall", "getobj", "getcount"];
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
		else if (t === "--verbs") verbs = (argv[++i] ?? "").split(",");
		else if (t === "--ids") {
			const raw = argv[++i] ?? "";
			ids = raw === "" ? [] : raw.split(",").map(Number);
			if (ids.some((n) => !Number.isInteger(n) || n < 0)) usage();
		} else if (t === "--ids-field") idsField = Number(argv[++i] ?? "1005");
		else if (t === "--u32-1005") u32single = Number(argv[++i] ?? "x");
		else if (t === "--bool-1008") {
			const b = argv[++i] ?? "";
			if (b !== "0" && b !== "1") usage();
			bool1008 = b === "1";
		} else if (t === "--route") {
			const parts = (argv[++i] ?? "").split(",").map(Number);
			if (parts.length !== 2 || parts.some((n) => !Number.isInteger(n)))
				usage();
			routes.push(parts as number[]);
		} else usage();
	}
	if (!Number.isInteger(idsField) || idsField < 0) usage();
	if (u32single !== null && (!Number.isInteger(u32single) || u32single < 0))
		usage();
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
				const extra: EncEntry[] = [...def.extra()];
				if (verb === "getobj") extra.push(encU32(0xfe0001, objId));
				if (ids !== null) extra.push(encU32Array(idsField, ids));
				if (u32single !== null) extra.push(encU32(1005, u32single));
				if (bool1008 !== null) extra.push(encBool(1008, bool1008));
				reqId = nextReqId(reqId);
				try {
					const res = await correlatedRequest(
						session.transport,
						buildRequest(route, def.cmd, session.sourceId, reqId, extra),
						reqId,
						{ timeoutMs, onCapture },
					);
					if (res.status === "ok") {
						const n = res.reply.entries.length;
						console.log(
							`census [${route}] ${verb}: ok fields=${n} statusWord=${String(res.statusWord)}`,
						);
					} else if (res.status === "router-error") {
						console.log(
							`census [${route}] ${verb}: ROUTER-ERROR errno=${res.errno} errstr=${JSON.stringify(res.errstr)}`,
						);
					} else {
						console.log(`census [${route}] ${verb}: ${res.status}`);
					}
				} catch (e) {
					console.log(`census [${route}] ${verb}: THREW ${(e as Error).message}`);
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
