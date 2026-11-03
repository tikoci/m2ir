// cspell:ignore getf1 setone nosuchuser
// K8 H-13-6-B M2 SET script (Phase K execution, counted writes).
// One CMD_SET (0xfe000e) per invocation on route [13,6] with f1 selector
// + optional f2 (string) / f3 (u32); lossless jsonl. Each invocation is
// ONE counted write — run only under an approved per-hunt budget.
//
// Usage:
//   bun set-136.ts --quickchr <name> --allowed-version <v> --out <step.jsonl> --f1 <selector> [--f2 <blob>] [--f3 <n>] [--timeout <ms>]

import {
	type EncEntry,
	encStr,
	encU32,
} from "../../../2026-10-chr-extraction/ws3c/m2.ts";
import {
	buildRequest,
	CMD_SET,
} from "../../../2026-10-chr-extraction/ws3c/probe.ts";
import { appendCapture, type CaptureRecord } from "../../harness/capture.ts";
import {
	correlatedRequest,
	nextReqId,
} from "../../harness/correlate.ts";
import { openSession } from "../../harness/session.ts";
import { resolveLabTarget } from "../../harness/target.ts";

function usage(): never {
	console.error(
		"usage: set-136.ts --quickchr <name> [--allowed-version <v>] --out <jsonl> --f1 <selector> [--f2 <blob>] [--f3 <n>] [--timeout <ms>]",
	);
	process.exit(2);
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	let machine = "";
	let allowedVersion = "";
	let out = "";
	let timeoutMs = 8000;
	let f1 = "";
	let f2: string | null = null;
	let f3: number | null = null;
	for (let i = 0; i < argv.length; i++) {
		const t = argv[i] ?? "";
		if (t === "--quickchr") machine = argv[++i] ?? "";
		else if (t === "--allowed-version") allowedVersion = argv[++i] ?? "";
		else if (t === "--out") out = argv[++i] ?? "";
		else if (t === "--timeout") timeoutMs = Number(argv[++i] ?? "8000");
		else if (t === "--f1") f1 = argv[++i] ?? "";
		else if (t === "--f2") f2 = argv[++i] ?? "";
		else if (t === "--f3") f3 = Number(argv[++i] ?? "x");
		else usage();
	}
	if (!machine || !out || !f1) usage();
	if (f3 !== null && (!Number.isInteger(f3) || f3 < 0)) usage();

	const target = resolveLabTarget(machine, {
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
	try {
		const extra: EncEntry[] = [encStr(1, f1)];
		if (f2 !== null) extra.push(encStr(2, f2));
		if (f3 !== null) extra.push(encU32(3, f3));
		const reqId = nextReqId(1);
		try {
			const res = await correlatedRequest(
				session.transport,
				buildRequest([13, 6], CMD_SET, session.sourceId, reqId, extra),
				reqId,
				{ timeoutMs, onCapture },
			);
			if (res.status === "ok") {
				const n = res.reply.entries.length;
				console.log(
					`set-136 f1=${f1}: ok fields=${n} statusWord=${String(res.statusWord)}`,
				);
			} else if (res.status === "router-error") {
				console.log(
					`set-136 f1=${f1}: ROUTER-ERROR errno=${res.errno} errstr=${JSON.stringify(res.errstr)}`,
				);
			} else {
				console.log(`set-136 f1=${f1}: ${res.status}`);
			}
		} catch (e) {
			console.log(`set-136 f1=${f1}: THREW ${(e as Error).message}`);
		}
		console.log(`set-136: records=${captures.length} out=${out}`);
	} finally {
		session.close();
	}
}

if (import.meta.main) {
	main().catch((e: unknown) => {
		console.error(`set-136: ${(e as Error).message}`);
		process.exit(1);
	});
}
